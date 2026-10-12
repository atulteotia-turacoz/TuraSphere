"""Bulk Find-KOLs scrape: every Therapeutic Area x Country below, into a temp table.

The rows land in `kol_scrape_import` (same columns as `kol_pending`), never straight
in the live queue, so they can be shipped to the server and imported there as
Pending Verification with one INSERT ... SELECT (see 04_DATABASE_QUERIES.sql).

Sources are the free, worldwide ones the Scrape modal offers — PubMed authors and
ClinicalTrials.gov investigators — plus Practo for India where the area maps to a
Practo specialty. Google is left out (1,173 combos would burn the SerpAPI quota)
and so is CTRI (it needs a hand-typed captcha per search).

Run from backend/:
    venv/bin/python scripts/bulk_kol_scrape.py scrape [--workers 4] [--limit 40]
    venv/bin/python scripts/bulk_kol_scrape.py status
    venv/bin/python scripts/bulk_kol_scrape.py load-pending --user-id 7
    venv/bin/python scripts/bulk_kol_scrape.py dump [--out ../deployment/transfer/kol_scrape_import.sql]

`scrape` is resumable: finished (area, country) pairs are recorded in
`kol_scrape_import_progress` and skipped on the next run; failed ones are retried.
"""
import argparse
import hashlib
import logging
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: F401,E402 - registers every model so relationships resolve
from sqlalchemy import text  # noqa: E402

from app.api.endpoints.kol_scrape import _find_experience, _name_key, _practo_candidates, _split_name  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.schemas.kol_pending import ScrapeCriteria  # noqa: E402
from app.services.kol_enrichment_jobs import pubmed_credentials  # noqa: E402
from app.services.name_titles import split_title  # noqa: E402
from app.services.practo_service import PractoService  # noqa: E402
from app.services.research_kols import ctgov_candidates, pubmed_candidates  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bulk_kol_scrape")

# label stored on the row -> (topic searched, supporting keywords, Practo specialty or None).
# The topic is what the registries are searched for: a label like "Renal/ Nephrology"
# would read as a MeSH subheading in PubMed, so it is searched as "Nephrology".
THERAPEUTIC_AREAS = {
    "Oncology": ("Oncology", ["cancer", "tumor", "carcinoma", "lymphoma", "leukemia", "chemotherapy",
                              "immunotherapy", "radiotherapy", "metastatic"], "oncology"),
    "Cardiovascular and Vascular Diseases": ("Cardiology", [
        "cardiovascular", "heart failure", "coronary artery disease", "myocardial infarction",
        "atrial fibrillation", "hypertension", "peripheral artery disease", "atherosclerosis",
        "vascular disease"], "cardiology"),
    "Renal/ Nephrology": ("Nephrology", ["chronic kidney disease", "kidney failure", "dialysis",
                                         "kidney transplantation", "glomerulonephritis",
                                         "acute kidney injury", "nephropathy"], "nephrology"),
    "Neurology": ("Neurology", ["epilepsy", "stroke", "multiple sclerosis", "Parkinson disease",
                                "Alzheimer disease", "dementia", "migraine", "neuropathy",
                                "amyotrophic lateral sclerosis"], "neurology"),
    "Immunology and Rheumatology": ("Rheumatology", [
        "rheumatoid arthritis", "systemic lupus erythematosus", "psoriatic arthritis",
        "ankylosing spondylitis", "vasculitis", "autoimmune disease", "gout", "Sjogren syndrome"],
        "rheumatology"),
    "Infectious Diseases": ("Infectious Diseases", ["HIV", "tuberculosis", "malaria", "sepsis",
                                                    "antimicrobial resistance", "COVID-19", "dengue",
                                                    "fungal infection", "bacterial infection"], None),
    "Endocrinology": ("Endocrinology", ["diabetes mellitus", "thyroid", "obesity", "osteoporosis",
                                        "adrenal", "pituitary", "insulin", "polycystic ovary syndrome"],
                      "endocrinology"),
    "Gastroenterology": ("Gastroenterology", ["inflammatory bowel disease", "Crohn disease",
                                              "ulcerative colitis", "irritable bowel syndrome",
                                              "gastroesophageal reflux", "pancreatitis", "celiac disease",
                                              "endoscopy"], "gastroenterology"),
    "Hepatology": ("Hepatology", ["liver cirrhosis", "hepatitis B", "hepatitis C", "fatty liver disease",
                                  "liver transplantation", "hepatocellular carcinoma", "liver fibrosis"],
                   None),
    "Respiratory Diseases": ("Pulmonology", ["asthma", "chronic obstructive pulmonary disease",
                                             "interstitial lung disease", "pulmonary fibrosis",
                                             "bronchiectasis", "respiratory tract infection",
                                             "lung function"], "pulmonology"),
    "Psychiatry": ("Psychiatry", ["depression", "schizophrenia", "bipolar disorder", "anxiety disorder",
                                  "ADHD", "substance use disorder", "PTSD", "mental health"], "psychiatry"),
    "Dermatology": ("Dermatology", ["psoriasis", "atopic dermatitis", "acne", "vitiligo", "urticaria",
                                    "alopecia", "hidradenitis suppurativa", "skin disease"], "dermatology"),
    # The list said "Opthalmology" — stored under the correct spelling.
    "Ophthalmology": ("Ophthalmology", ["glaucoma", "cataract", "diabetic retinopathy", "macular degeneration",
                                        "uveitis", "retina", "myopia", "dry eye"], "ophthalmology"),
    "Hematology": ("Hematology", ["anemia", "thalassemia", "sickle cell disease", "hemophilia",
                                  "multiple myeloma", "leukemia", "lymphoma", "thrombosis",
                                  "bone marrow transplantation"], None),
    "Urology": ("Urology", ["prostate", "benign prostatic hyperplasia", "urinary incontinence", "urolithiasis",
                            "bladder cancer", "overactive bladder", "erectile dysfunction"], "urology"),
    "Gynecology and Obstetrics": ("Gynecology", ["obstetrics", "pregnancy", "infertility",
                                                 "in vitro fertilization", "endometriosis",
                                                 "polycystic ovary syndrome", "preeclampsia", "menopause"],
                                  "gynecology"),
    "Anesthesiology and Pain Management": ("Anesthesiology", [
        "anesthesia", "chronic pain", "pain management", "regional anesthesia", "postoperative pain",
        "nerve block", "analgesia", "perioperative"], None),
    "Radiology": ("Radiology", ["diagnostic imaging", "magnetic resonance imaging", "computed tomography",
                                "interventional radiology", "ultrasonography", "positron emission tomography"],
                  None),
    "Musculoskeletal and Orthopedics": ("Orthopedics", [
        "osteoarthritis", "fracture", "arthroplasty", "spine surgery", "sports injury", "knee replacement",
        "musculoskeletal", "osteoporosis"], "orthopedics"),
    "Sleep Disorders": ("Sleep Disorders", ["obstructive sleep apnea", "insomnia", "narcolepsy",
                                            "restless legs syndrome", "sleep medicine", "polysomnography"],
                        None),
    "Rare Disease": ("Rare Disease", ["orphan disease", "lysosomal storage disease", "Gaucher disease",
                                      "Fabry disease", "Pompe disease", "spinal muscular atrophy",
                                      "cystic fibrosis", "Duchenne muscular dystrophy",
                                      "mucopolysaccharidosis"], None),
    "Vaccines and Preventive Medicines": ("Vaccine", ["vaccination", "immunization", "preventive medicine",
                                                      "vaccine efficacy", "influenza vaccine", "HPV vaccine",
                                                      "vaccine hesitancy"], None),
    "Allergy and Clinical Immunology": ("Allergy", ["allergic rhinitis", "food allergy", "anaphylaxis",
                                                    "primary immunodeficiency", "allergen immunotherapy",
                                                    "chronic urticaria", "eosinophilic"], None),
}

# As given, with spellings normalised to the app's country list
# (frontend/src/utils/countries.js) so the Country facet / filter matches them.
COUNTRIES = [
    "Canada", "Chile", "Mexico", "Peru", "United States", "China", "Hong Kong", "South Korea", "Taiwan",
    "Japan", "Indonesia", "Malaysia", "Philippines", "Thailand", "Vietnam", "Australia", "New Zealand",
    "Papua New Guinea", "Austria", "Belgium", "Denmark", "Finland", "Greece", "Norway", "Portugal", "Sweden",
    "Hungary", "Croatia", "Luxembourg", "Czech Republic", "Poland", "Bulgaria", "Colombia", "Argentina",
    "Singapore", "Egypt", "Algeria", "Kuwait", "Qatar", "Oman", "Bahrain", "Kazakhstan", "Uzbekistan",
    "Pakistan", "Bangladesh", "Bhutan", "Nepal", "Myanmar", "Maldives", "Sri Lanka", "India",
]

DDL = [
    """CREATE TABLE IF NOT EXISTS kol_scrape_import (
        id INT NOT NULL AUTO_INCREMENT,
        identity_hash CHAR(40) NOT NULL,
        source VARCHAR(20) NOT NULL,
        title VARCHAR(20) NULL,
        first_name VARCHAR(150) NULL,
        last_name VARCHAR(150) NULL,
        email VARCHAR(255) NULL,
        contact_no VARCHAR(120) NULL,
        therapeutic_area VARCHAR(255) NULL,
        also_found_under VARCHAR(1000) NULL,
        geographic_zone VARCHAR(60) NULL,
        state_city VARCHAR(255) NULL,
        specialty VARCHAR(255) NULL,
        subspecialty VARCHAR(255) NULL,
        institution VARCHAR(255) NULL,
        designation VARCHAR(255) NULL,
        influence_level VARCHAR(40) NULL,
        experience_years INT NULL,
        practo_profile_url VARCHAR(300) NULL,
        web_profile_url VARCHAR(500) NULL,
        notes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_kol_scrape_import_identity (identity_hash),
        KEY ix_kol_scrape_import_ta (therapeutic_area),
        KEY ix_kol_scrape_import_zone (geographic_zone),
        KEY ix_kol_scrape_import_source (source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci""",
    """CREATE TABLE IF NOT EXISTS kol_scrape_import_progress (
        therapeutic_area VARCHAR(255) NOT NULL,
        geographic_zone VARCHAR(60) NOT NULL,
        status VARCHAR(20) NOT NULL,
        found INT NOT NULL DEFAULT 0,
        inserted INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        finished_at DATETIME NULL,
        PRIMARY KEY (therapeutic_area, geographic_zone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci""",
]

ROW_COLUMNS = ["identity_hash", "source", "title", "first_name", "last_name", "email", "contact_no",
               "therapeutic_area", "geographic_zone", "state_city", "specialty", "subspecialty", "institution",
               "designation", "influence_level", "experience_years", "practo_profile_url", "web_profile_url",
               "notes"]

_LIMITS = {"title": 20, "first_name": 150, "last_name": 150, "email": 255, "contact_no": 120,
           "state_city": 255, "specialty": 255, "subspecialty": 255, "institution": 255, "designation": 255,
           "practo_profile_url": 300, "web_profile_url": 500}


def _notes(c: dict) -> str | None:
    """The same extras the Scrape modal folds into `notes` (KOLScrapePanel.submit)."""
    web = c["source"] in ("google", "pubmed", "ctgov")
    parts = [
        c.get("practo_qualifications") and f"Qualifications: {'; '.join(c['practo_qualifications'])}",
        c.get("practo_registration") and (f"Reg: {c['practo_registration']}"
                                          + (" (verified)" if c.get("practo_registration_verified") else "")),
        c.get("practo_memberships") and f"Memberships: {'; '.join(c['practo_memberships'])}",
        c.get("practo_languages") and f"Languages: {', '.join(c['practo_languages'])}",
        c.get("practo_rating") is not None and f"Rating: {c['practo_rating']}% ({c.get('practo_reviews_count') or 0} reviews)",
        c.get("practo_fee") is not None and f"Fee: ₹{c['practo_fee']}",
        c.get("postal_code") and f"PIN: {c['postal_code']}",
        web and c.get("web_page_title") and f"Found on: {c['web_page_title']}",
        web and c["source"] != "google" and c.get("institution") and f"Affiliation: {c['institution']}",
        web and c.get("bio") and c["bio"].replace("|", "/"),
    ]
    return " | ".join(p for p in parts if p) or None


def _row(c: dict, ta: str, country: str) -> dict:
    """A candidate as a pending row — the mapping of KOLScrapePanel.submit +
    submit_for_approval, so an imported row looks like one sent from the modal."""
    src = c["source"]
    title, bare = split_title(c.get("name") or "")
    if not title and src in ("practo", "google"):
        title = "Dr."
    first, last = _split_name(bare)
    identity = c["profile_url"]
    row = {
        "identity_hash": hashlib.sha1(f"{src}|{identity}".encode()).hexdigest(),
        "source": src,
        "title": title,
        "first_name": first,
        "last_name": last,
        "email": c.get("email"),
        "contact_no": c.get("contact_no"),
        "therapeutic_area": ta,
        "geographic_zone": country,
        "state_city": ", ".join(p for p in (c.get("locality") or c.get("city"), c.get("state")) if p)
                      or c.get("location"),
        "specialty": c.get("specialty"),
        "subspecialty": c.get("subspecialty"),
        "institution": c.get("institution"),
        "designation": c.get("designation"),
        "influence_level": c.get("suggested_influence_level"),
        "experience_years": c.get("experience_years") or _find_experience(c.get("bio")),
        "practo_profile_url": identity if src == "practo" else None,
        "web_profile_url": identity if src != "practo" else None,
        "notes": _notes(c),
    }
    for k, n in _LIMITS.items():
        if row[k]:
            row[k] = str(row[k]).strip()[:n] or None
    return row


def scrape_combo(ta: str, country: str, limit: int, pubmed_key: str) -> tuple[list[dict], list[str]]:
    topic, keywords, practo_specialty = THERAPEUTIC_AREAS[ta]
    crit = ScrapeCriteria(therapeutic_area=topic, geographic_zone=country, limit=limit)
    notes: list[str] = []
    found: list[dict] = []

    def run(name, fn, *args):
        for attempt in range(3):
            try:
                return fn(*args)
            except Exception as exc:  # noqa: BLE001 - one source failing must not sink the combo
                if attempt == 2:
                    notes.append(f"{name} failed: {exc.__class__.__name__}: {exc}")
                    return []
                time.sleep(5 * (attempt + 1))

    if country == "India" and practo_specialty and PractoService.serves_country(country):
        found += run("Practo", _practo_candidates,
                     ScrapeCriteria(specialty=practo_specialty, geographic_zone=country, limit=limit,
                                    enrich_profiles=True), notes)
    # Same order and merge as the /scrape endpoint: a research hit naming someone
    # already found hands over its email / phone instead of adding a twin.
    for name, fn, args in (("PubMed", pubmed_candidates, (crit, notes, pubmed_key, keywords)),
                           ("ClinicalTrials.gov", ctgov_candidates, (crit, notes, keywords))):
        res = run(name, fn, *args)
        known = {_name_key(c.get("name")): c for c in found}
        for c in res:
            twin = known.get(_name_key(c["name"]))
            if twin is not None:
                for f in ("email", "contact_no"):
                    if c.get(f) and not twin.get(f):
                        twin[f] = c[f]
        found += [c for c in res if _name_key(c["name"]) not in known]
    return [_row(c, ta, country) for c in found if c.get("profile_url") and c.get("name")], notes


def save(conn, ta: str, country: str, rows: list[dict], notes: list[str], failed: bool) -> int:
    inserted = 0
    cols = ", ".join(ROW_COLUMNS)
    vals = ", ".join(f":{c}" for c in ROW_COLUMNS)
    # Already found under another area: keep the first row, remember this area too.
    sql = text(f"""INSERT INTO kol_scrape_import ({cols}) VALUES ({vals})
        ON DUPLICATE KEY UPDATE
          email = COALESCE(email, VALUES(email)),
          contact_no = COALESCE(contact_no, VALUES(contact_no)),
          also_found_under = IF(therapeutic_area = VALUES(therapeutic_area)
                                OR FIND_IN_SET(VALUES(therapeutic_area), also_found_under), also_found_under,
                                LEFT(CONCAT_WS(',', also_found_under, VALUES(therapeutic_area)), 1000))""")
    for r in rows:
        inserted += 1 if conn.execute(sql, r).rowcount == 1 else 0
    conn.execute(text("""REPLACE INTO kol_scrape_import_progress
        (therapeutic_area, geographic_zone, status, found, inserted, notes, finished_at)
        VALUES (:ta, :country, :status, :found, :inserted, :notes, :at)"""),
                 {"ta": ta, "country": country, "status": "error" if failed else "done", "found": len(rows),
                  "inserted": inserted, "notes": "\n".join(notes)[:60000], "at": datetime.utcnow()})
    return inserted


def cmd_scrape(args) -> None:
    with engine.begin() as conn:
        for ddl in DDL:
            conn.execute(text(ddl))
        done = {(t, c) for t, c in conn.execute(text(
            "SELECT therapeutic_area, geographic_zone FROM kol_scrape_import_progress WHERE status = 'done'"))}
    db = SessionLocal()
    pubmed_key = pubmed_credentials(db)[0] or settings.PUBMED_API_KEY
    db.close()
    tas = [t for t in THERAPEUTIC_AREAS if not args.ta or t in args.ta]
    countries = [c for c in COUNTRIES if not args.country or c in args.country]
    todo = [(t, c) for c in countries for t in tas if (t, c) not in done]
    print(f"{len(todo)} of {len(tas) * len(countries)} combos to scrape "
          f"(PubMed key: {'yes' if pubmed_key else 'no'}, workers {args.workers}, limit {args.limit})", flush=True)
    started, total_new = time.time(), 0
    # A network call can hang past its own timeout (seen once: every worker idle for
    # 10+ min). Threads can't be killed, so exit and let a re-run resume — finished
    # combos are recorded, the stuck ones are simply redone.
    last_done = [time.time()]

    def watchdog():
        while True:
            time.sleep(30)
            if time.time() - last_done[0] > args.stall_minutes * 60:
                print(f"No combo finished in {args.stall_minutes} min — exiting so a re-run can resume.", flush=True)
                os._exit(3)
    threading.Thread(target=watchdog, daemon=True).start()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(scrape_combo, t, c, args.limit, pubmed_key): (t, c) for t, c in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            ta, country = futs[fut]
            try:
                rows, notes = fut.result()
                failed = any(" failed: " in n for n in notes) and not rows
            except Exception as exc:  # noqa: BLE001
                rows, notes, failed = [], [f"combo failed: {exc!r}"], True
            with engine.begin() as conn:
                new = save(conn, ta, country, rows, notes, failed)
            total_new += new
            last_done[0] = time.time()
            rate = (time.time() - started) / i
            print(f"[{i}/{len(todo)}] {ta} · {country}: {len(rows)} found, {new} new"
                  f"{' (ERROR)' if failed else ''} — total {total_new}, ~{rate * (len(todo) - i) / 60:.0f} min left",
                  flush=True)


def cmd_status(_args) -> None:
    with engine.connect() as conn:
        for q in ("SELECT status, COUNT(*), SUM(found), SUM(inserted) FROM kol_scrape_import_progress GROUP BY status",
                  "SELECT source, COUNT(*), SUM(email IS NOT NULL), SUM(contact_no IS NOT NULL) "
                  "FROM kol_scrape_import GROUP BY source",
                  "SELECT COUNT(*) FROM kol_scrape_import"):
            print(q.split(" FROM ")[0])
            for r in conn.execute(text(q)):
                print("  ", tuple(r))


# Explicit COLLATE: kol_pending / kol_directory are utf8mb4_general_ci here, and a
# server whose tables differ would otherwise fail with "Illegal mix of collations".
# The exact statement the server import runs too (04_DATABASE_QUERIES.sql) — rows
# land as Pending Verification, skipping anyone the account already has queued or
# in its directory.
LOAD_PENDING_SQL = """
INSERT INTO kol_pending
  (user_id, status, source, title, first_name, last_name, email, contact_no, therapeutic_area,
   geographic_zone, state_city, specialty, subspecialty, institution, designation, influence_level,
   experience_years, practo_profile_url, web_profile_url, notes, enrichment_status, created_at, updated_at)
SELECT :owner_id, 'pending', i.source, i.title, i.first_name, i.last_name, i.email, i.contact_no,
       i.therapeutic_area, i.geographic_zone, i.state_city, i.specialty, i.subspecialty, i.institution,
       i.designation, i.influence_level, i.experience_years, i.practo_profile_url, i.web_profile_url,
       CONCAT_WS(' | ', i.notes, IF(i.also_found_under IS NULL, NULL,
                 CONCAT('Also found under: ', REPLACE(i.also_found_under, ',', ', ')))),
       'none', NOW(), NOW()
FROM kol_scrape_import i
WHERE NOT EXISTS (SELECT 1 FROM kol_pending p WHERE p.user_id = :owner_id AND (
        (i.web_profile_url IS NOT NULL AND p.web_profile_url = i.web_profile_url COLLATE utf8mb4_general_ci)
     OR (i.practo_profile_url IS NOT NULL AND p.practo_profile_url = i.practo_profile_url COLLATE utf8mb4_general_ci)))
  AND NOT EXISTS (SELECT 1 FROM kol_directory d WHERE d.user_id = :owner_id AND (
        (i.web_profile_url IS NOT NULL AND d.web_profile_url = i.web_profile_url COLLATE utf8mb4_general_ci)
     OR (i.practo_profile_url IS NOT NULL AND d.practo_profile_url = i.practo_profile_url COLLATE utf8mb4_general_ci)))
"""


def cmd_load_pending(args) -> None:
    with engine.begin() as conn:
        n = conn.execute(text(LOAD_PENDING_SQL), {"owner_id": args.user_id}).rowcount
    print(f"{n} rows added to kol_pending as Pending Verification for user {args.user_id}")


def _sql_literal(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return f"'{v:%Y-%m-%d %H:%M:%S}'"
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r") \
        .replace("\x00", "\\0").replace("\x1a", "\\Z")
    return f"'{s}'"


def cmd_dump(args) -> None:
    """A self-contained .sql for the server: CREATE TABLE + INSERTs (no mysqldump here)."""
    with engine.connect() as conn:
        ddl = conn.execute(text("SHOW CREATE TABLE kol_scrape_import")).fetchone()[1]
        result = conn.execute(text("SELECT * FROM kol_scrape_import ORDER BY id"))
        cols = list(result.keys())
        rows = result.fetchall()
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(f"-- kol_scrape_import: bulk Find-KOLs scrape, {len(rows)} rows, dumped {datetime.now():%Y-%m-%d %H:%M}\n")
        f.write("-- Load with: mysql --default-character-set=utf8mb4 -u <user> -p <db> < this_file.sql\n")
        if args.owner_email:
            f.write(f"-- Fills kol_scrape_import, then copies it into kol_pending (Pending Verification) for\n"
                    f"-- {args.owner_email}, skipping anyone that account already has. Safe to run again.\n")
        else:
            f.write("-- Then move the rows into Pending Verification — see 04_DATABASE_QUERIES.sql.\n")
        f.write("SET NAMES utf8mb4;\nDROP TABLE IF EXISTS kol_scrape_import;\n")
        f.write(re.sub(r" AUTO_INCREMENT=\d+", "", ddl) + ";\n")
        col_sql = ", ".join(f"`{c}`" for c in cols)
        for i in range(0, len(rows), 500):
            vals = ",\n".join("(" + ", ".join(_sql_literal(v) for v in r) + ")" for r in rows[i:i + 500])
            f.write(f"INSERT INTO kol_scrape_import ({col_sql}) VALUES\n{vals};\n")
        if args.owner_email:
            # A missing account leaves @owner_id NULL, and kol_pending.user_id is NOT NULL,
            # so the INSERT fails loudly instead of importing rows nobody owns.
            f.write("\n-- Move the rows into Pending Verification.\n")
            f.write(f"SET @owner_id = (SELECT id FROM users WHERE email = {_sql_literal(args.owner_email)});\n")
            f.write(LOAD_PENDING_SQL.strip().replace(":owner_id", "@owner_id") + ";\n")
            f.write("SELECT @owner_id AS owner_id, COUNT(*) AS pending_rows FROM kol_pending "
                    "WHERE user_id = @owner_id AND status = 'pending';\n")
            f.write("-- Once checked: DROP TABLE kol_scrape_import;\n")
    print(f"wrote {len(rows)} rows to {args.out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scrape")
    s.add_argument("--workers", type=int, default=4)
    s.add_argument("--limit", type=int, default=40, help="max people per source per combo (modal default 40)")
    s.add_argument("--ta", action="append", help="only this therapeutic area (repeatable)")
    s.add_argument("--country", action="append", help="only this country (repeatable)")
    s.add_argument("--stall-minutes", type=int, default=5, help="exit if no combo finishes for this long")
    s.set_defaults(fn=cmd_scrape)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    lp = sub.add_parser("load-pending")
    lp.add_argument("--user-id", type=int, required=True)
    lp.set_defaults(fn=cmd_load_pending)
    d = sub.add_parser("dump")
    d.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "deployment",
                                                 "transfer", "kol_scrape_import.sql"))
    d.add_argument("--owner-email", help="also append the INSERT into kol_pending for this account")
    d.set_defaults(fn=cmd_dump)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
