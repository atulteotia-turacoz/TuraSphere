"""Background enrichment jobs for KOL rows (pending candidates and directory entries).

`kol_enrichment.enrich_record` does the actual PubMed / ClinicalTrials.gov /
Scholar work. This module is the DB-facing half: it resolves credentials, runs
enrichment for a row, and persists status + payload.

Both `kol_pending` and `kol_directory` carry the same three columns
(`enrichment_status`, `enrichment_data`, `enrichment_updated_at`), so one worker
serves both — the caller passes the model class.
"""
import asyncio
import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.crypto import decrypt
from app.core.database import SessionLocal
from app.models.configuration import PubMedConfig
from app.services.kol_enrichment import enrich_record

logger = logging.getLogger(__name__)


def pubmed_credentials(db: Session) -> tuple[str, str]:
    """The active default PubMed key/email from super-admin config (falling back to
    env). Returns ('', '') if none — the NCBI API still works keyless, just slower."""
    cfg = (db.query(PubMedConfig)
           .filter(PubMedConfig.is_active.is_(True), PubMedConfig.is_default.is_(True))
           .first())
    if cfg and (cfg.api_key or cfg.email):
        # The key may be stored encrypted ("enc::…"). One that won't decrypt here
        # (encrypted under another server's secret) would make NCBI answer every
        # call "API key invalid" — go keyless instead, which still works.
        key = decrypt(cfg.api_key or "")
        if key.startswith("enc::"):
            logger.warning("PubMed API key (config %s) can't be decrypted — using PubMed without a key. "
                           "Re-enter it in super admin.", cfg.id)
            key = ""
        return key, cfg.email or ""
    from app.core.config import settings
    return getattr(settings, "PUBMED_API_KEY", "") or "", getattr(settings, "NCBI_EMAIL", "") or ""


def enrich_entry(entry, api_key: str, email: str) -> None:
    """Enrich a single row in place and set status + payload. Does not commit."""
    name = f"{entry.first_name or ''} {entry.last_name or ''}".strip() \
        or getattr(entry, "x_name", None) or getattr(entry, "x_username", None)
    if not name:
        entry.enrichment_status = "error"
        entry.enrichment_data = json.dumps({"error": "no name to search on"})
        entry.enrichment_updated_at = datetime.utcnow()
        return
    # state_city is stored "Locality, State" — the first part is the best affiliation.
    city = (entry.state_city or "").split(",")[0].strip()
    try:
        data = asyncio.run(enrich_record(
            name=name, specialty=entry.specialty or entry.therapeutic_area or "",
            city=city, institution=entry.institution or "",
            pubmed_api_key=api_key, pubmed_email=email,
            user_id=getattr(entry, "user_id", None),
        ))
        entry.enrichment_status = "done"
        entry.enrichment_data = json.dumps(data)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Enrichment failed for %s %s: %s", entry.__class__.__name__, entry.id, exc)
        entry.enrichment_status = "error"
        entry.enrichment_data = json.dumps({"error": exc.__class__.__name__})
    entry.enrichment_updated_at = datetime.utcnow()


def run_enrichment(model, ids: list[int]) -> None:
    """Background worker: enrich each row of `model` on its own DB session.

    Runs outside the request, so it owns a fresh session. Each row is committed
    individually, so the progress bar advances one doctor at a time and a failure
    on one candidate never rolls back the others.
    """
    api_key = email = None
    for row_id in ids:
        db = SessionLocal()
        try:
            entry = db.query(model).filter(model.id == row_id).first()
            if not entry:
                continue
            if api_key is None:  # resolve credentials once, lazily
                api_key, email = pubmed_credentials(db)
            enrich_entry(entry, api_key, email)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Enrichment worker error on %s %s: %s", model.__name__, row_id, exc)
            db.rollback()
        finally:
            db.close()
