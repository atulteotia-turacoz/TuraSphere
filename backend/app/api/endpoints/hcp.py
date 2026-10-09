import os
import json
import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.hcp import HCPProfile
from pydantic import BaseModel
from app.schemas.hcp import HCPCreate, HCPUpdate, HCPResponse, HCPListResponse, HCPDuplicateCheckRequest
from app.services.cv_parser import CVParser
from app.services import cv_rule_extractor
from app.services.hcp_duplicates import (
    cv_fingerprint,
    duplicate_report,
    describe_match,
    AUTO_MERGE_CONFIDENCES,
)
from app.services.ai_scoring_service import get_default_ai_config, call_openai, call_anthropic, _parse_json_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hcp", tags=["HCP Profiles"])


EXTRACTION_PROMPT = """You are an expert at extracting structured information from healthcare professional CVs/resumes.

Analyze the provided CV content and extract the relevant fields. Be thorough and accurate.

## Fields to Extract:
1. full_name: The person's full name (include title like Dr. if present)
2. city: City or location where they are based
3. specialty: Their medical specialty or therapeutic area (e.g. Cardiology, Oncology)
4. institution: **ALL** current affiliations, comma-separated — a consultant commonly holds a teaching post and two or three clinics at the same time, and listing only the first understates them. Include every post in faculty_positions whose status is current (dates reading "Till date", "Present", "ongoing"). Example: "Sri Muthukumaran Medical College and Research Institute, Aesthetiq Clinic, Gowri Clinic, Pranaya Speciality Hospital"
5. designation: Current designation(s) or position(s), comma-separated if the person holds more than one concurrently (e.g. "Professor and HOD, Consultant Dermatologist")
6. pg_qualification_year: The four-digit year the person COMPLETED their primary postgraduate medical degree — MD, MS, DNB, DM, MCh or direct equivalent. Use the END year of that degree's date range (e.g. "MD (DVL) 04/2012 - 10/2015" -> 2015). This is NOT: MBBS, a diploma, a certificate, a fellowship, a "mini fellowship", a foundation course, or any short course, however recent — those are extra training, not the primary PG degree. If the person genuinely holds no postgraduate degree, give the MBBS completion year instead and nothing else. Return null only if no qualification year appears anywhere.
6d. unique_expertise: any distinctive surgical or clinical capability the CV claims — a technique, device, sub-speciality or procedure few peers offer (e.g. "Quad-wavelength diode laser", "robotic hair restoration"). Null if nothing stands out.
6e. procedures_per_year: approximate number of surgeries or procedures performed per year, as an integer, if the CV states or implies one. Null if absent — do not guess.
6f. age_estimate: approximate current age as an integer, inferred from the MBBS start or completion year (medical school typically begins around age 18). Null if no such year is present.
6c. education: every medical qualification with its year, newest first, as one line — e.g. "MD (DVL), Aarupadai Veedu Medical College, 2015; MBBS, Mahatma Gandhi Medical College, 2007; Diploma in Aesthetic Medicine, 2018". Include MBBS, the postgraduate degree, and any fellowships or diplomas. This is what the graduation and post-graduation criteria are scored from, so never leave it blank when the CV lists degrees.
6b. years_of_experience: leave this null — the system computes it from pg_qualification_year. Only fill it if the CV has no qualification years at all AND states a figure outright.
7. key_clinical_interests: Key clinical or research interests (comma-separated)
8. publications: **Array** of published articles, one object per paper. Keys: title (the article title), journal (the journal or publication name), year (four-digit year of publication, or null if genuinely absent), scope ("international" or "national", or null if unclear — judge from the journal, not from where the author lives. A journal is international unless it is clearly the organ of a single country's society or is named for one country/state — so "International Journal of ...", "Global Journal of ...", "African Journal of ...", "European ...", "Journal of Population Therapeutics and Clinical Pharmacology", Lancet, NEJM, BMJ are all international, while "Indian Journal of Dermatology", "Apollo Medicine" or a state chapter bulletin are national. Abbreviated titles count too: expand them before judging). Return [] if none. Extract EVERY paper listed, each with its own year — a bare count cannot be scored against the rubric's "in the past five years" publication criteria.
9. conference_presentations: **Array** of conference presentations / speaker activities. Each item is an object with keys: topic (short topic/title), year (year as string, or null), with_whom (organizer / society / co-speaker, or null), scope ("international" or "national", or null if genuinely unclear). Return [] if none. Extract ALL distinct items if multiple. IMPORTANT: Look not only at sections literally titled "Presentations" but also anywhere the CV mentions speaking, posters, oral presentations, young-investigator awards at named conferences, conference travel grants, or any item of the form "<award/activity> at <conference> <year>" — include each such item as its own row. Pull distinct entries from "Presentations", "Highlights", "Achievements", or bullet lists that refer to specific conferences.
   For **scope**, judge each talk separately — this drives a scoring criterion, so do not default everything to one value. Use "international" when the conference is held outside the HCP's home country, OR is run by an international society/committee (e.g. ESC, ACC, AHA, ASCO, ERS, WHO), OR the CV itself calls it international/global/world congress. Use "national" for a home-country congress, a state or regional chapter meeting, or a local CME. Use null only when the CV gives no clue at all.
10. professional_memberships: Professional society memberships (e.g. CSI, AHA Fellow)
11. awards_recognitions: Awards and recognitions received
12. medical_registration_no: Medical council registration / license number (e.g. MCI-12345, state council number), or null
13. advisory_board: **Array** of advisory board memberships / participations. Each item is an object with keys: topic (board name / topic), year (year as string, or null), with_whom (pharma/industry/academic body, or null). Return [] if none. Extract ALL distinct items if multiple.
14. affiliated_to_government: "yes" if affiliated with a government institution/organisation, "no" otherwise, or null
15. email: The person's email address exactly as written in the CV (e.g. name@hospital.org), or null. If several appear, pick the personal/professional one belonging to the HCP, not a department or assistant address.
16. mobile: The person's mobile / phone number exactly as written, keeping the country code and separators (e.g. "+91 98765 43210"), or null. If several appear, prefer the mobile/cell over a landline or fax.
17. textbooks: **Array** of books / textbooks / book chapters the person wrote or edited. Each item is an object with keys: title (book or chapter title), role (one of "author", "co_author", "editor", "chapter_author", or null if unclear), year (year as string, or null). Return [] if none. Extract ALL distinct items. These are BOOKS, not journal articles — never move a peer-reviewed paper here. Look under "Books", "Publications", "Chapters", "Monographs", "Editorial work", and phrases like "contributed a chapter to", "co-edited", "section editor of <book>".
18. office_bearer_positions: **Array** of POSITIONS HELD in medical societies / associations / professional bodies — not plain membership. Each item is an object with keys: position (e.g. President, Vice President, Secretary, Treasurer, Governing Council Member, Executive Board Member, Chairperson), organization (the society or association), scope ("international" or "national", or null if unclear), year (year or term as a string such as "2022-24", or null). Return [] if none. Extract ALL distinct items, past and current.
   Being an ordinary MEMBER or Fellow of a society is NOT an office-bearer position — that belongs in professional_memberships. Only include a row when the CV states an office, post, council seat or board seat the person held. Set scope to "international" for bodies like ESC, ACC, AHA, WHO or any society described as international/global; "national" for a country-level or state-chapter body.
19. faculty_positions: **Array** of academic / institutional positions held — the person's career history, PAST AND CURRENT, one row per post. Each item is an object with keys: institution (hospital, medical college or organisation), position (e.g. Professor, Associate Professor, HOD, Senior Consultant, Registrar), status ("current" or "past", or null if unclear), years (the period exactly as written, e.g. "2015-2020" or "2018-Present", or null). Return [] if none. Extract ALL distinct posts, including the current one.
   Set status from the dates: an open-ended period ("2018-Present", "since 2020", "till date") is "current"; a closed period ("2012-2016") is "past". If the CV lists several posts at the same institution over time, give each its own row — never collapse a career history into one row.

## Instructions:
- Extract ONLY what is explicitly stated or clearly implied in the CV.
- For text fields, provide concise summaries (1-2 sentences max).
- Do not compute years of experience yourself. Return pg_qualification_year and let the system subtract. A figure stated in CV prose ("15 years' experience") is the author's own claim, usually counted from MBBS or their first job, and must not override the PG year.
- If a field cannot be determined, return null.
- Respond with valid JSON only.

## Response Format:
{
  "full_name": "...",
  "city": "...",
  "specialty": "...",
  "institution": "...",
  "designation": "...",
  "pg_qualification_year": 2015,
  "education": "...",
  "unique_expertise": "...",
  "procedures_per_year": null,
  "age_estimate": null,
  "years_of_experience": null,
  "key_clinical_interests": "...",
  "publications": [{"title": "...", "year": "...", "journal": "...", "scope": "international"}],
  "conference_presentations": [{"topic": "...", "year": "...", "with_whom": "...", "scope": "international"}],
  "professional_memberships": "...",
  "awards_recognitions": "...",
  "medical_registration_no": "...",
  "advisory_board": [{"topic": "...", "year": "...", "with_whom": "..."}],
  "affiliated_to_government": "...",
  "email": "...",
  "mobile": "...",
  "textbooks": [{"title": "...", "role": "author", "year": "..."}],
  "office_bearer_positions": [{"position": "...", "organization": "...", "scope": "national", "year": "..."}],
  "faculty_positions": [{"institution": "...", "position": "...", "status": "current", "years": "..."}]
}"""

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".bmp"}

# Field extraction is a transcription job, not a creative one. Accounts commonly
# run a higher temperature for scoring (0.7), which made the same CV yield
# different years_of_experience / row counts on every upload — so pin it low here.
EXTRACTION_TEMPERATURE = 0.1

# The response carries five array fields (publications, presentations, advisory
# boards, textbooks, office bearer, faculty positions). Off a long CV that does
# not fit the 4096 accounts are configured with — the JSON came back cut
# mid-string and the whole extraction failed, leaving the user to type an
# 11-page CV by hand. gpt-4o allows 16k output; 8k is ample for this shape.
EXTRACTION_MAX_TOKENS = 8000

# How much CV text reaches the prompt. The old 15k cap silently dropped the tail
# of any longer CV — usually publications, awards and memberships, which sit at
# the end. ~60k chars is roughly 15k tokens, comfortable for a 128k-context model.
CV_TEXT_LIMIT = 60000


def _call_vision_openai(config, image_b64: str, media_type: str) -> dict:
    """Call OpenAI with an image for vision-based extraction."""
    from openai import OpenAI

    client_kwargs = {"api_key": config.api_key}
    if config.api_base_url:
        client_kwargs["base_url"] = config.api_base_url
    client = OpenAI(**client_kwargs)

    response = client.chat.completions.create(
        model=config.model_name or "gpt-4o",
        messages=[
            {"role": "system", "content": "You are a healthcare CV extraction expert. Always respond with valid JSON only."},
            {"role": "user", "content": [
                {"type": "text", "text": EXTRACTION_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_b64}"}},
            ]},
        ],
        max_tokens=EXTRACTION_MAX_TOKENS,
        temperature=EXTRACTION_TEMPERATURE,
        timeout=90,
    )
    return _parse_json_response(response.choices[0].message.content)


def _call_vision_anthropic(config, image_b64: str, media_type: str) -> dict:
    """Call Anthropic Claude with an image for vision-based extraction."""
    import anthropic

    client_kwargs = {"api_key": config.api_key}
    if config.api_base_url:
        client_kwargs["base_url"] = config.api_base_url
    client = anthropic.Anthropic(**client_kwargs)

    response = client.messages.create(
        model=config.model_name or "claude-sonnet-4-20250514",
        max_tokens=EXTRACTION_MAX_TOKENS,
        temperature=EXTRACTION_TEMPERATURE,
        system="You are a healthcare CV extraction expert. Always respond with valid JSON only.",
        messages=[
            {"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": EXTRACTION_PROMPT},
            ]},
        ],
    )
    return _parse_json_response(response.content[0].text)


def _merge_extractions(base: dict, incoming: dict) -> dict:
    """Fold one page's extraction into the running result.

    A scanned CV is read a page at a time, so each call sees only part of the
    document. Scalars keep the first non-empty answer — the name and specialty
    are on page one and a later page guessing again would overwrite good data.
    Row fields accumulate, de-duplicated, because publications and posts run
    across pages.
    """
    merged = dict(base)
    for key, value in (incoming or {}).items():
        if key in ROW_KEYS:
            rows = list(merged.get(key) or [])
            seen = {json.dumps(r, sort_keys=True) for r in rows if isinstance(r, dict)}
            for row in _normalize_rows(value, key):
                fingerprint = json.dumps(row, sort_keys=True)
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    rows.append(row)
            merged[key] = rows
        elif value not in (None, "", []) and not merged.get(key):
            merged[key] = value
    return merged


def _pdf_pages_as_png(file_path: str, max_pages: int = 4):
    """Render the first pages of a PDF to PNG bytes using PyMuPDF.

    Scanned CVs carry no text layer, so `CVParser` returned "" and extraction
    failed with "Could not extract text from CV" — four of the eleven CVs the
    client supplied for testing are exactly this. The parser's OCR fallback
    silently returns "" too, because it needs pdf2image plus the tesseract and
    poppler binaries, none of which are installed.

    PyMuPDF is already a dependency and needs no system packages, so the pages
    go through the AI vision path that image CVs have always used. Capped at a
    few pages: each one is an image in the prompt, and the identity, posts and
    qualifications that drive scoring sit at the front of a CV.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return []
    pages = []
    try:
        with fitz.open(file_path) as doc:
            for page in doc[:max_pages]:
                # ~150 dpi: legible to a vision model without a huge payload.
                pix = page.get_pixmap(matrix=fitz.Matrix(150 / 72, 150 / 72))
                pages.append(pix.tobytes("png"))
    except Exception as exc:
        logger.warning(f"Could not rasterise PDF for vision fallback: {exc}")
        return []
    return pages


def _empty_extraction():
    return {
        "full_name": None, "city": None, "specialty": None,
        "institution": None, "designation": None, "years_of_experience": None,
        "pg_qualification_year": None, "education": None,
        "unique_expertise": None, "procedures_per_year": None, "age_estimate": None,
        "key_clinical_interests": None, "publications": [],
        "conference_presentations": [], "professional_memberships": None,
        "awards_recognitions": None, "medical_registration_no": None,
        "advisory_board": [], "affiliated_to_government": None,
        "email": None, "mobile": None,
        "textbooks": [], "office_bearer_positions": [], "faculty_positions": [],
    }


# Sections the model returns as ARRAYS of rows rather than free text — the form
# renders each as a repeatable row block. `fields` is the column order (also the
# order used when the rows are serialized into one string for storage);
# `aliases` catches the other names the model reaches for.
ROW_SPECS = {
    # A publication list is only scoreable if each paper carries its own year:
    # the rubric asks for articles "in past five years", and a lump sum of
    # "7 papers" cannot answer that. Same row shape as presentations.
    "publications": {
        "fields": ("title", "year", "journal", "scope"),
        "aliases": {
            "title": ("topic", "article", "paper", "name"),
            "journal": ("with_whom", "publication", "publisher", "source"),
            "scope": ("level", "type", "national_or_international"),
        },
    },
    "conference_presentations": {
        "fields": ("topic", "year", "with_whom", "scope"),
        "aliases": {
            "topic": ("title", "presentation"),
            "with_whom": ("organizer", "with", "conference", "society"),
            "scope": ("level", "type", "national_or_international"),
        },
    },
    "advisory_board": {
        "fields": ("topic", "year", "with_whom"),
        "aliases": {
            "topic": ("title", "board", "board_name"),
            "with_whom": ("organizer", "with", "company", "sponsor"),
        },
    },
    "textbooks": {
        "fields": ("title", "role", "year"),
        "aliases": {
            "title": ("topic", "book", "book_title", "name", "chapter"),
            "role": ("contribution", "type", "capacity"),
        },
    },
    # Career history. The single "Current Institute" field on the form records
    # today's post; this records the whole run of them, current and past, which
    # the scoring rubric asks for ("Past/current leader", "in the last 5 years").
    "faculty_positions": {
        "fields": ("institution", "position", "status", "years"),
        "aliases": {
            "institution": ("organization", "organisation", "hospital", "employer", "with_whom", "place"),
            "position": ("title", "role", "designation", "topic"),
            "status": ("current_or_past", "state"),
            "years": ("year", "period", "duration", "dates", "from_to"),
        },
    },
    "office_bearer_positions": {
        "fields": ("position", "organization", "scope", "year"),
        "aliases": {
            "position": ("title", "role", "designation"),
            "organization": ("society", "association", "body", "with_whom", "organisation"),
            "scope": ("level", "type", "national_or_international"),
        },
    },
}
ROW_KEYS = tuple(ROW_SPECS)

# Fields rendered as a dropdown rather than free text. A row carrying nothing but
# these is noise, and each gets normalized onto its fixed set of values.
DROPDOWN_FIELDS = ("scope", "role", "status")


def _normalize_scope(val) -> str:
    """Map anything the model says about reach onto national | international | ''."""
    t = str(val or "").strip().lower()
    if not t:
        return ""
    if any(w in t for w in ("intern", "intl", "global", "world", "abroad", "overseas", "foreign")):
        return "international"
    if any(w in t for w in ("nation", "domestic", "local", "state", "regional", "india")):
        return "national"
    return ""


def _normalize_status(val) -> str:
    """Map a position's tense onto current | past | ''."""
    t = str(val or "").strip().lower()
    if not t:
        return ""
    if any(w in t for w in ("present", "current", "ongoing", "till date", "to date", "now", "incumbent", "since")):
        return "current"
    if any(w in t for w in ("past", "former", "previous", "ex-", "erstwhile", "retired", "until", "till ")):
        return "past"
    return ""


def _normalize_role(val) -> str:
    """Map a textbook contribution onto the roles the form offers, or '' if unclear.

    Blank is deliberate: the scoring rubric distinguishes author from editor, so
    guessing would be worse than leaving the dropdown for the user to set.
    """
    t = str(val or "").strip().lower()
    if not t:
        return ""
    if "editor" in t or "edited" in t:
        return "editor"
    if "chapter" in t:
        return "chapter_author"
    if "co-author" in t or "coauthor" in t or "co author" in t:
        return "co_author"
    if "author" in t or "wrote" in t or "written" in t:
        return "author"
    return ""


def _row_value(item: dict, field: str, aliases: dict) -> str:
    """First non-empty value for `field` among its own key and its aliases."""
    for name in (field,) + tuple(aliases.get(field, ())):
        val = item.get(name)
        if val is None:
            continue
        text_val = str(val).strip()
        if text_val:
            return text_val
    return ""


def _normalize_rows(val, key: str = "conference_presentations"):
    """Accept list[dict], dict, or string and return a list of clean row dicts.

    Every row carries exactly the fields declared for its section, so the form
    can render it without guarding for missing keys.
    """
    spec = ROW_SPECS.get(key) or ROW_SPECS["conference_presentations"]
    fields, aliases = spec["fields"], spec["aliases"]

    def blank():
        return {f: "" for f in fields}

    def clean(item: dict):
        row = blank()
        for field in fields:
            value = _row_value(item, field, aliases)
            if field == "scope":
                value = _normalize_scope(value)
            elif field == "role":
                value = _normalize_role(value)
            elif field == "status":
                value = _normalize_status(value)
            row[field] = value
        # "2015 - Present" already says the post is current; read it off the dates
        # rather than making the user restate it in the dropdown.
        if "status" in fields and not row["status"]:
            row["status"] = _normalize_status(row.get("years") or row.get("year") or "")
        # A row whose only content is a normalized dropdown is noise, so require
        # at least one of the free-text/year fields to be filled.
        if any(row[f] for f in fields if f not in DROPDOWN_FIELDS):
            return row
        return None

    if val is None:
        return []
    if isinstance(val, dict):
        val = [val]
    if isinstance(val, list):
        rows = []
        for item in val:
            if isinstance(item, dict):
                row = clean(item)
                if row:
                    rows.append(row)
            elif isinstance(item, str) and item.strip():
                # Bare string — everything lands in the section's first column.
                row = blank()
                row[fields[0]] = item.strip()
                rows.append(row)
        return rows
    if isinstance(val, str) and val.strip():
        # Legacy free-text fallback — one row, first column only
        row = blank()
        row[fields[0]] = val.strip()
        return [row]
    return []


def _years_since_pg(result: dict):
    """Years of experience = current year - PG completion year, computed here.

    The model used to be asked for the subtraction itself and was unreliable at
    it: the same CV gave 17 (counted from the first job), then 11 (correct, from
    MD 2015), then 8 (it had latched onto a 2018 aesthetic-medicine *diploma*).
    The rubric means years since the primary postgraduate degree, so the model
    now returns only that year and the arithmetic happens here — deterministic,
    and auditable because the year it used is stored alongside.
    """
    from datetime import date
    raw = result.get("pg_qualification_year")
    try:
        year = int(str(raw).strip()[:4])
    except (TypeError, ValueError):
        return None
    this_year = date.today().year
    # A qualification year outside living memory, or in the future, is a
    # misread — better to fall back than to publish a nonsense figure.
    if year < 1950 or year > this_year:
        return None
    return this_year - year


def _normalize_extracted(result: dict) -> dict:
    expected_keys = [
        "full_name", "city", "specialty", "institution", "designation",
        "years_of_experience", "pg_qualification_year", "education",
        "unique_expertise", "procedures_per_year", "age_estimate",
        "key_clinical_interests", "publications",
        "conference_presentations", "professional_memberships", "awards_recognitions",
        "medical_registration_no", "advisory_board", "affiliated_to_government",
        "email", "mobile", "textbooks", "office_bearer_positions", "faculty_positions",
    ]
    extracted = {}
    computed_years = _years_since_pg(result)
    for key in expected_keys:
        val = result.get(key)
        if key in ROW_KEYS:
            extracted[key] = _normalize_rows(val, key)
            continue
        if key == "years_of_experience" and computed_years is not None:
            # The computed figure wins; a model-supplied one is only a fallback
            # for CVs carrying no qualification year at all.
            extracted[key] = computed_years
            continue
        if val is not None and str(val).strip():
            extracted[key] = val if key == "years_of_experience" else str(val).strip()
        else:
            extracted[key] = None

    if extracted["years_of_experience"] is not None:
        try:
            extracted["years_of_experience"] = int(extracted["years_of_experience"])
        except (ValueError, TypeError):
            extracted["years_of_experience"] = None

    return extracted


@router.post("/extract-cv-fields")
async def extract_cv_fields(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Extract form-relevant fields from an uploaded CV.

    With AI on, a model reads the CV. With AI off, the same fields are read by
    the rule engine in `cv_rule_extractor` — no model, no network, and the same
    CV always yields the same form.
    """
    ai_allowed = bool(getattr(current_user, "ai_enabled", True))
    allowed_ext = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Save to temp location
    temp_dir = os.path.join(settings.UPLOAD_DIR, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, f"{uuid.uuid4().hex}{ext}")

    try:
        with open(temp_path, "wb") as f:
            file_bytes = await file.read()
            f.write(file_bytes)

        # Fingerprint the file before reading it: whichever extraction path runs
        # below, the answer to "have we assessed this CV already?" is the same.
        cv_hash = cv_fingerprint(file_bytes)

        def with_duplicates(result: dict) -> dict:
            """Every extraction path returns through here.

            The form is about to be filled in and submitted, and that submission
            used to create a second record for someone already on file. Deciding
            it here — where the CV's own name, email, mobile and registration
            number have just been read — is the only point at which the page can
            warn before the user starts typing.
            """
            result["cv_hash"] = cv_hash
            try:
                result["duplicate_check"] = duplicate_report(
                    db, current_user,
                    full_name=result.get("full_name"),
                    email=result.get("email"),
                    mobile=result.get("mobile"),
                    medical_registration_no=result.get("medical_registration_no"),
                    city=result.get("city"),
                    institution=result.get("institution"),
                    cv_hash=cv_hash,
                )
            except Exception as exc:
                # A failing duplicate check must never cost the user their
                # extraction — the form still fills, the warning is just absent.
                logger.warning(f"Duplicate check failed during CV extraction: {exc}")
                result["duplicate_check"] = {"matches": [], "best_match": None, "auto_merge": False}
            return result

        # ── AI OFF: read the document's own structure, and nothing leaves here ──
        if not ai_allowed:
            # Scans and photographs go through CVParser's Tesseract path, not
            # through vision: OCR is local character recognition, so it stays
            # within what "no AI" means here — nothing is sent to a model.
            parsed = CVParser.parse_file(temp_path)
            raw_text = parsed.get("raw_text", "").strip()
            if not raw_text:
                raise HTTPException(
                    status_code=400,
                    # Three different remedies, so name the one that applies.
                    detail=(
                        "Could not read this .doc/.ppt file. Legacy Office formats need "
                        "LibreOffice installed on the server to be converted — please "
                        "re-save it as .docx, .pptx or PDF and upload again."
                        if ext in (".doc", ".ppt") else
                        "Could not read any text from this CV. It is a scan or a photo, and "
                        "reading one without AI needs the OCR tools (tesseract, and poppler "
                        "for PDFs) installed on the server. Install those, upload a "
                        "text-based PDF, DOCX or PPTX, or enter the details manually."
                    ),
                )
            logger.info(
                f"Rule-based CV extraction ({ext}): {len(raw_text)} chars, no AI called"
            )
            result = _normalize_extracted(cv_rule_extractor.extract_fields(raw_text))
            result["extraction_mode"] = "rules"
            return with_duplicates(result)

        config = get_default_ai_config(db)
        is_image = ext in IMAGE_EXTENSIONS

        # --- IMAGE PATH: use AI vision directly ---
        if is_image:
            if not config:
                raise HTTPException(
                    status_code=400,
                    detail="AI configuration required for image CV extraction. Please configure an AI provider.",
                )
            import base64
            image_b64 = base64.b64encode(file_bytes).decode("utf-8")
            media_type_map = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".tiff": "image/tiff", ".bmp": "image/bmp",
            }
            media_type = media_type_map.get(ext, "image/png")

            provider = (config.provider or "").lower()
            try:
                if provider in ("anthropic", "claude"):
                    result = _call_vision_anthropic(config, image_b64, media_type)
                else:
                    result = _call_vision_openai(config, image_b64, media_type)
            except Exception as e:
                logger.error(f"AI vision extraction failed: {e}")
                raise HTTPException(status_code=400, detail=f"AI could not read the image: {str(e)}")

            return with_duplicates({**_normalize_extracted(result), "extraction_mode": "ai"})

        # --- TEXT DOCUMENT PATH: parse text then use AI ---
        parsed = CVParser.parse_file(temp_path)
        raw_text = parsed.get("raw_text", "").strip()
        logger.info(f"CV text extraction for {ext}: {len(raw_text)} chars extracted")
        if not raw_text and ext == ".pdf" and config:
            # No text layer: a scan. Read it with vision rather than giving up.
            pages = _pdf_pages_as_png(temp_path)
            if pages:
                import base64
                logger.info(f"Scanned PDF: falling back to vision over {len(pages)} page(s)")
                provider = (config.provider or "").lower()
                merged = _empty_extraction()
                for png in pages:
                    b64 = base64.b64encode(png).decode("utf-8")
                    try:
                        if provider in ("anthropic", "claude"):
                            page_result = _call_vision_anthropic(config, b64, "image/png")
                        else:
                            page_result = _call_vision_openai(config, b64, "image/png")
                    except Exception as exc:
                        logger.warning(f"Vision failed on a scanned page: {exc}")
                        continue
                    merged = _merge_extractions(merged, page_result)
                return with_duplicates({**_normalize_extracted(merged), "extraction_mode": "ai"})

        if not raw_text:
            logger.error(f"Empty text from CV: {ext}, parsed error: {parsed.get('error', 'none')}")
            raise HTTPException(
                status_code=400,
                # Format-specific, because the remedy differs: a scan needs AI
                # vision configured, a legacy binary Office file needs
                # LibreOffice on the server.
                detail=(
                    "Could not read this .doc/.ppt file. Legacy Office formats need "
                    "LibreOffice installed on the server to be converted — please "
                    "re-save it as .docx, .pptx or PDF and upload again."
                    if ext in (".doc", ".ppt") else
                    "Could not read this CV. It appears to be a scan with no text layer, "
                    "and AI vision is unavailable — configure an AI provider, or upload a "
                    "text-based PDF, DOCX or PPTX."
                ),
            )

        if not config:
            regex_fields = parsed.get("parsed", {})
            fallback = _empty_extraction()
            fallback["specialty"] = regex_fields.get("specialty")
            fallback["designation"] = regex_fields.get("faculty_positions")
            fallback["years_of_experience"] = regex_fields.get("years_of_experience")
            fallback["extraction_mode"] = "rules"
            return with_duplicates(fallback)

        if len(raw_text) > CV_TEXT_LIMIT:
            logger.warning(
                f"CV text truncated for extraction: {len(raw_text)} -> {CV_TEXT_LIMIT} chars"
            )
        text_prompt = f"{EXTRACTION_PROMPT}\n\n## CV Content:\n---\n{raw_text[:CV_TEXT_LIMIT]}\n---"

        provider = (config.provider or "").lower()
        try:
            if provider in ("anthropic", "claude"):
                result = call_anthropic(config, text_prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
            else:
                result = call_openai(config, text_prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
        except Exception as e:
            logger.error(f"AI extraction failed: {e}")
            regex_fields = parsed.get("parsed", {})
            fallback = _empty_extraction()
            fallback["specialty"] = regex_fields.get("specialty")
            fallback["designation"] = regex_fields.get("faculty_positions")
            fallback["years_of_experience"] = regex_fields.get("years_of_experience")
            fallback["extraction_mode"] = "rules"
            return with_duplicates(fallback)

        return with_duplicates({**_normalize_extracted(result), "extraction_mode": "ai"})

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


# ── Bulk paste: turn a pasted block of text into rows ───────────────────────
# The tedious path is a CV the AI could not read: the user then adds speaking
# engagements and advisory boards one row at a time, three or four boxes each.
# This lets them paste the whole list — copied straight out of the CV or an
# email — and have it split into rows in one shot.

PASTE_PROMPT_INTROS = {
    "conference_presentations": (
        "Each entry is a conference presentation / speaking engagement. Fields: "
        "topic (talk title or subject), year, with_whom (conference, society or "
        "co-speaker), scope (\"international\" or \"national\", or null if unclear — "
        "international means held abroad or run by an international society such as "
        "ESC/ACC/AHA/ASCO/WHO; national means a home-country, state or local meeting)."
    ),
    "advisory_board": (
        "Each entry is an advisory board membership or participation. Fields: "
        "topic (board name or subject), year, with_whom (pharma company, industry "
        "or academic body)."
    ),
    "textbooks": (
        "Each entry is a book, textbook or book chapter the person wrote or edited "
        "— never a journal article. Fields: title, role (one of \"author\", "
        "\"co_author\", \"editor\", \"chapter_author\", or null if unclear), year."
    ),
    "faculty_positions": (
        "Each entry is an academic or institutional position held — career "
        "history, past and current. Fields: institution, position (Professor, "
        "HOD, Senior Consultant, ...), status (\"current\" or \"past\", or null if "
        "unclear — an open-ended period is current, a closed one is past), years "
        "(the period as written, e.g. \"2015-2020\" or \"2018-Present\")."
    ),
    "office_bearer_positions": (
        "Each entry is a POSITION HELD in a medical society or association — not "
        "plain membership. Fields: position (President, Secretary, Governing "
        "Council Member, ...), organization (the society), scope (\"international\" "
        "or \"national\", or null if unclear), year (a year or a term like \"2022-24\")."
    ),
}

# A pasted list is long but shallow; this is generous for even a 50-line block.
PASTE_TEXT_LIMIT = 20000


class RowPasteRequest(BaseModel):
    kind: str
    text: str


@router.post("/parse-rows")
def parse_rows(
    payload: RowPasteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Split a pasted block of text into structured rows for one form section."""
    kind = (payload.kind or "").strip()
    if kind not in ROW_SPECS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown section '{kind}'. Expected one of: {', '.join(ROW_SPECS)}.",
        )

    text_in = (payload.text or "").strip()
    if not text_in:
        raise HTTPException(status_code=400, detail="Nothing to convert — paste some text first.")

    # With AI off, the same split runs on rules. The user has already told us
    # which section this is, so there is nothing here a model is needed for.
    if not getattr(current_user, "ai_enabled", True):
        rows = _normalize_rows(cv_rule_extractor.parse_rows(kind, text_in[:PASTE_TEXT_LIMIT]), kind)
        return {"kind": kind, "rows": rows, "parse_mode": "rules"}

    config = get_default_ai_config(db)
    if not config:
        raise HTTPException(
            status_code=400,
            detail="AI configuration required to convert pasted text. Please configure an AI provider.",
        )

    fields = ROW_SPECS[kind]["fields"]
    example = "{" + ", ".join(f'"{f}": "..."' for f in fields) + "}"
    prompt = (
        "You split a pasted list into structured rows. "
        f"{PASTE_PROMPT_INTROS[kind]}\n\n"
        "## Rules:\n"
        "- Return ONE row per distinct entry. Do not merge two entries into one row.\n"
        "- Do not invent anything. If a field is not present in the text, use null.\n"
        "- Keep the wording from the text; only shorten obvious boilerplate.\n"
        "- Ignore headings, numbering, bullets and page numbers.\n"
        "- Respond with valid JSON only, in the form "
        f'{{"rows": [{example}]}}\n\n'
        f"## Text to split:\n---\n{text_in[:PASTE_TEXT_LIMIT]}\n---"
    )

    provider = (config.provider or "").lower()
    try:
        if provider in ("anthropic", "claude"):
            result = call_anthropic(config, prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
        else:
            result = call_openai(config, prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
    except Exception as e:
        logger.error(f"Row paste parsing failed for kind={kind}: {e}")
        raise HTTPException(status_code=400, detail=f"AI could not split the pasted text: {str(e)}")

    # Tolerate a bare array as well as the requested {"rows": [...]} envelope.
    raw_rows = result.get("rows") if isinstance(result, dict) else result
    if raw_rows is None and isinstance(result, dict):
        raw_rows = result.get(kind)
    rows = _normalize_rows(raw_rows, kind)
    return {"kind": kind, "rows": rows}


# Fields a duplicate-merge is allowed to refresh on the existing record. The
# rest of the row (ids, timestamps, file paths, status) belongs to the record
# that is already there and is never overwritten by a re-submission.
MERGEABLE_FIELDS = (
    "full_name", "email", "mobile", "therapeutic_area", "city", "country",
    "specialty", "medical_registration_no", "hcp_type", "institution",
    "affiliations", "years_of_experience", "procedures_per_year",
    "unique_expertise", "faculty_positions", "education", "age_estimate",
    "designation", "key_clinical_interests", "publications",
    "conference_presentations", "advisory_board", "textbooks",
    "office_bearer_positions", "affiliated_to_government",
    "professional_memberships", "awards_recognitions",
)


def _merge_into_existing(db: Session, hcp: HCPProfile, data: HCPCreate,
                         current_user: User, match: dict, response: Response) -> HCPProfile:
    """Fold a duplicate submission into the record it duplicates.

    Two audit entries come out of this, because two different things happened:
    the system decided these are the same person (`duplicate_detected`), and the
    profile was edited as a result (`hcp_updated`). Separating them keeps the
    trail answerable — "why was no new record created?" and "what changed on the
    existing one?" have different answers.
    """
    if current_user.role == "user" and hcp.user_id != current_user.id:
        # Should be unreachable — the candidate query is already scoped to the
        # user — but a merge writing across accounts is not a bug to discover
        # later.
        raise HTTPException(status_code=403, detail="Access denied")

    incoming = data.model_dump(exclude_unset=True)
    changed = []
    for field in MERGEABLE_FIELDS:
        if field not in incoming:
            continue
        value = incoming[field]
        # A blank in the new submission is an absence, not an instruction to
        # erase what the existing record already holds.
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if getattr(hcp, field, None) != value:
            setattr(hcp, field, value)
            changed.append(field)

    from app.models.audit_log import AuditLog
    from app.models.assessment import Assessment
    latest = (
        db.query(Assessment)
        .filter(Assessment.hcp_id == hcp.id)
        .order_by(Assessment.created_at.desc())
        .first()
    )
    # Attached to the current assessment, because the trail on the results page
    # is keyed on assessment ids. The re-assessment that follows this call gets
    # its own entry from the scoring endpoint.
    db.add(AuditLog(
        assessment_id=latest.id if latest else None,
        action="duplicate_detected",
        details=(
            f"A new assessment was submitted for an HCP already on file "
            f"(#{hcp.id} — {hcp.full_name or 'unnamed'}); matched on "
            f"{describe_match(match)}. No new record was created — this profile "
            f"is being re-assessed."
        ),
        performed_by=current_user.id,
    ))
    if changed:
        db.add(AuditLog(
            assessment_id=latest.id if latest else None,
            action="hcp_updated",
            details=f"Profile fields updated from the re-submitted details: {', '.join(sorted(changed))}",
            performed_by=current_user.id,
        ))

    db.commit()
    db.refresh(hcp)
    # 200, not 201: nothing was created. The form reads this to know it is now
    # looking at an existing record rather than a new one.
    response.status_code = 200
    return hcp


@router.post("/check-duplicate")
def check_duplicate(data: HCPDuplicateCheckRequest, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Is this person already on file?

    Called from the New Assessment form as identity fields are filled in — by
    the CV extraction, or by hand when there is no CV to upload. Read-only: it
    decides nothing, it only reports what matched and how strongly.
    """
    return duplicate_report(
        db, current_user,
        full_name=data.full_name,
        email=data.email,
        mobile=data.mobile,
        medical_registration_no=data.medical_registration_no,
        city=data.city,
        institution=data.institution,
        cv_hash=data.cv_hash,
        exclude_id=data.exclude_id,
    )


@router.post("/", response_model=HCPResponse, status_code=201)
def create_hcp(data: HCPCreate, response: Response, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    """Create an HCP — or return the existing one when this is the same person.

    Re-uploading a CV that has already been assessed used to produce a second
    `hcp_profiles` row: two records for one doctor, two unrelated score
    histories, and nothing tying them together. A confident identity match now
    updates the record that is already there and hands it back, so the caller's
    next steps — upload the CV, run the scoring — land on the original id and
    register as a re-assessment on that HCP's audit trail.

    On its own the server only merges an `exact` or `strong` match (the same
    file, or the same registration number / email / mobile). A weaker match is
    reported to the form, which asks the user — and comes back as `merge_into`
    if they confirm it. Nothing weak is ever decided silently here.
    """
    # An explicitly confirmed duplicate wins over everything: the user has been
    # shown the match and said it is the same person, which is a stronger
    # signal than any rule here. `force_new` cannot apply — the form never
    # sends both, and if something else does, "this IS record N" is the more
    # specific instruction.
    if data.merge_into:
        existing = db.query(HCPProfile).filter(HCPProfile.id == data.merge_into).first()
        if existing is None:
            raise HTTPException(status_code=404, detail="The HCP to merge into was not found")
        # Re-run the match purely to describe it in the audit entry — a trail
        # saying "matched on email address, name" is checkable, "the user said
        # so" is not.
        report = duplicate_report(
            db, current_user,
            full_name=data.full_name,
            email=data.email,
            mobile=data.mobile,
            medical_registration_no=data.medical_registration_no,
            city=data.city,
            institution=data.institution,
            cv_hash=data.cv_hash,
        )
        match = next(
            (m for m in report.get("matches", []) if m["hcp_id"] == existing.id),
            {"matched_on": [], "confidence": "confirmed"},
        )
        return _merge_into_existing(db, existing, data, current_user, match, response)

    if not data.force_new:
        report = duplicate_report(
            db, current_user,
            full_name=data.full_name,
            email=data.email,
            mobile=data.mobile,
            medical_registration_no=data.medical_registration_no,
            city=data.city,
            institution=data.institution,
            cv_hash=data.cv_hash,
        )
        best = report.get("best_match")
        if best and best["confidence"] in AUTO_MERGE_CONFIDENCES:
            existing = db.query(HCPProfile).filter(HCPProfile.id == best["hcp_id"]).first()
            if existing is not None:
                return _merge_into_existing(db, existing, data, current_user, best, response)

    hcp = HCPProfile(
        user_id=current_user.id,
        full_name=data.full_name or "Unnamed HCP",
        email=data.email,
        mobile=data.mobile,
        therapeutic_area=data.therapeutic_area,
        city=data.city,
        country=data.country,
        specialty=data.specialty,
        medical_registration_no=data.medical_registration_no,
        hcp_type=data.hcp_type or "non_surgeon_doctor",
        institution=data.institution,
        affiliations=data.affiliations,
        years_of_experience=data.years_of_experience,
        procedures_per_year=data.procedures_per_year,
        unique_expertise=data.unique_expertise,
        faculty_positions=data.faculty_positions,
        education=data.education,
        age_estimate=data.age_estimate,
        designation=data.designation,
        # Everything below was previously accepted by HCPCreate, sent by the
        # New Assessment form, and then silently dropped here — the columns were
        # never assigned, so hand-typed details never reached the DB and the
        # scoring prompt (which reads these same columns) only ever saw the CV.
        key_clinical_interests=data.key_clinical_interests,
        publications=data.publications,
        conference_presentations=data.conference_presentations,
        advisory_board=data.advisory_board,
        textbooks=data.textbooks,
        office_bearer_positions=data.office_bearer_positions,
        affiliated_to_government=data.affiliated_to_government,
        professional_memberships=data.professional_memberships,
        awards_recognitions=data.awards_recognitions,
        status="draft",
    )
    db.add(hcp)
    db.commit()
    db.refresh(hcp)
    return hcp


@router.get("/", response_model=HCPListResponse)
def list_hcps(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=1000),
              search: Optional[str] = None, status: Optional[str] = None,
              db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    query = db.query(HCPProfile)
    if current_user.role == "user":
        query = query.filter(HCPProfile.user_id == current_user.id)
    if search:
        query = query.filter(HCPProfile.full_name.ilike(f"%{search}%"))
    if status:
        query = query.filter(HCPProfile.status == status)
    total = query.count()
    items = query.order_by(HCPProfile.created_at.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": items}


@router.get("/{hcp_id}", response_model=HCPResponse)
def get_hcp(hcp_id: int, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return hcp


@router.put("/{hcp_id}", response_model=HCPResponse)
def update_hcp(hcp_id: int, data: HCPUpdate, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    update_data = data.model_dump(exclude_unset=True)
    # Which fields actually changed — a re-assessment edits this profile first,
    # and "the score moved" is only half the story without "because these fields
    # were changed, by this person, at this time".
    changed = [k for k, v in update_data.items() if getattr(hcp, k, None) != v]
    for key, value in update_data.items():
        setattr(hcp, key, value)

    if changed:
        from app.models.audit_log import AuditLog
        from app.models.assessment import Assessment
        latest = (
            db.query(Assessment)
            .filter(Assessment.hcp_id == hcp.id)
            .order_by(Assessment.created_at.desc())
            .first()
        )
        db.add(AuditLog(
            # Attached to the current assessment so it appears in that HCP's
            # trail, which is keyed on assessment ids.
            assessment_id=latest.id if latest else None,
            action="hcp_updated",
            details=f"Profile fields edited: {', '.join(sorted(changed))}",
            performed_by=current_user.id,
        ))

    db.commit()
    db.refresh(hcp)
    return hcp


@router.delete("/{hcp_id}")
def delete_hcp(hcp_id: int, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # There is no FK cascade on assessment_parameter_scores, and this deleted
    # only the HCP — so its assessments and their per-parameter rows were
    # orphaned. MySQL then hands the next assessment a recycled id and it
    # inherits those stale rows, which is how a results page ended up showing
    # every parameter twice with contradictory scores. The admin delete already
    # cleaned up; this one did not.
    from app.models.assessment import Assessment
    from app.models.assessment_score import AssessmentParameterScore
    assessments = db.query(Assessment).filter(Assessment.hcp_id == hcp_id).all()
    for a in assessments:
        db.query(AssessmentParameterScore).filter(
            AssessmentParameterScore.assessment_id == a.id
        ).delete(synchronize_session=False)
        db.delete(a)

    db.delete(hcp)
    db.commit()
    return {"detail": "HCP deleted"}


@router.post("/{hcp_id}/upload-cv", response_model=HCPResponse)
async def upload_cv(hcp_id: int, file: UploadFile = File(...),
                    db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_ext = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    upload_dir = os.path.join(settings.UPLOAD_DIR, str(current_user.id))
    os.makedirs(upload_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, filename)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    parsed = CVParser.parse_file(file_path)
    if not parsed.get("raw_text", "").strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract text from CV. Please ensure the file is not a scanned image or is a readable PDF/DOCX."
        )
    hcp.cv_file_path = file_path
    hcp.cv_parsed_data = json.dumps(parsed)
    # Recorded so the next upload of this exact file is recognised as the same
    # HCP without needing the CV to spell out an email or registration number.
    hcp.cv_file_hash = cv_fingerprint(content)

    # Auto-fill fields from parsed CV if empty
    parsed_fields = parsed.get("parsed", {})
    if not hcp.years_of_experience and parsed_fields.get("years_of_experience"):
        hcp.years_of_experience = parsed_fields["years_of_experience"]
    if not hcp.education and parsed_fields.get("education"):
        hcp.education = parsed_fields["education"]
    if not hcp.faculty_positions and parsed_fields.get("faculty_positions"):
        hcp.faculty_positions = parsed_fields["faculty_positions"]
    if not hcp.specialty and parsed_fields.get("specialty"):
        hcp.specialty = parsed_fields["specialty"]
    if not hcp.procedures_per_year and parsed_fields.get("procedures_per_year"):
        hcp.procedures_per_year = parsed_fields["procedures_per_year"]

    db.commit()
    db.refresh(hcp)
    return hcp


# ── Consent letter ───────────────────────────────────────────────────────────
# The signed consent from the HCP. Deliberately NOT run through CVParser: it is
# a compliance record, not a source of profile data, so it never parses and
# never auto-fills the form. That also means an image-only scan is fine here,
# whereas the CV upload rejects one it cannot read.

CONSENT_ALLOWED_EXT = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"}


@router.post("/{hcp_id}/upload-consent", response_model=HCPResponse)
async def upload_consent(hcp_id: int, file: UploadFile = File(...),
                         db: Session = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in CONSENT_ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext or '(none)'}. "
                   f"Allowed: {', '.join(sorted(CONSENT_ALLOWED_EXT))}",
        )

    upload_dir = os.path.join(settings.UPLOAD_DIR, str(current_user.id), "consent")
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, f"{uuid.uuid4().hex}{ext}")
    with open(file_path, "wb") as f:
        f.write(await file.read())

    # Replacing a consent letter removes the previous file — there is one
    # current consent per HCP, and leaving orphans behind in the upload
    # directory is how a "deleted" document survives on disk.
    old_path = hcp.consent_file_path
    hcp.consent_file_path = file_path
    hcp.consent_uploaded_at = datetime.utcnow()
    db.commit()
    db.refresh(hcp)
    if old_path and old_path != file_path and os.path.exists(old_path):
        try:
            os.remove(old_path)
        except OSError:
            pass          # a stale file is not worth failing the upload over
    return hcp


@router.get("/{hcp_id}/download-consent")
def download_consent(hcp_id: int, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if not hcp.consent_file_path or not os.path.exists(hcp.consent_file_path):
        raise HTTPException(status_code=404, detail="No consent letter available")

    filename = f"{(hcp.full_name or 'HCP').replace(' ', '_')}_Consent" \
               f"{os.path.splitext(hcp.consent_file_path)[1]}"
    return FileResponse(
        path=hcp.consent_file_path,
        filename=filename,
        media_type="application/octet-stream",
    )


@router.get("/{hcp_id}/download-cv")
def download_cv(hcp_id: int, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")
    if current_user.role == "user" and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if not hcp.cv_file_path or not os.path.exists(hcp.cv_file_path):
        raise HTTPException(status_code=404, detail="No CV file available")

    filename = f"{hcp.full_name.replace(' ', '_')}_CV{os.path.splitext(hcp.cv_file_path)[1]}"
    return FileResponse(
        path=hcp.cv_file_path,
        filename=filename,
        media_type="application/octet-stream",
    )
