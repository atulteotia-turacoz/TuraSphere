"""CTRI (Clinical Trials Registry - India, ctri.nic.in) as a KOL source.

CTRI has no API. Its search form is protected by a CAPTCHA, so a search can only
run after a person has typed the code — we never try to solve it. The flow is:

1. `start_session()` opens a CTRI session, reads the form's anti-forgery tokens
   and fetches the CAPTCHA image. The session state (cookies + tokens) goes back
   to the client as an opaque token, so nothing is kept in server memory and any
   worker can finish the search.
2. `search()` posts the form with the code the user typed. The result page lists
   every matching trial (number, title, status, condition, sites) but no people.
3. `fetch_trials()` reads each trial's public detail page — no CAPTCHA there —
   for the principal investigator and every site investigator, with
   designation, institution, address, phone and email.
4. `group_investigators()` folds those into one record per person, with the
   trials they ran — a KOL candidate.

A CAPTCHA is single-use: every search needs a freshly typed code.
"""
from __future__ import annotations

import base64
import html
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

BASE = "https://ctri.nic.in/Clinicaltrials"
_FORM_URL = f"{BASE}/advancesearchmain.php"
_SEARCH_URL = f"{BASE}/advsearch.php"
_CAPTCHA_URL = f"{BASE}/advancesearch.php?action=captcha"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
# Every "ALL" select the form posts alongside the keyword.
_ALL_FIELDS = ("pros", "month", "year", "study", "sdid", "phaseid", "psponsor",
               "recid", "state", "district")


class CTRIError(Exception):
    """CTRI unreachable or answered with something we can't read."""


class CTRICaptchaError(CTRIError):
    """The code typed didn't match (or the session expired) — fetch a new one."""


def _client(cookies: Optional[dict] = None) -> httpx.Client:
    return httpx.Client(headers=_HEADERS, cookies=cookies or {}, timeout=60,
                        follow_redirects=True)


def detail_url(trial_id: int | str) -> str:
    """Public detail page of a trial. CTRI's `EncHid` is the trial id, base64'd."""
    enc = base64.b64encode(str(trial_id).encode()).decode()
    return f"{BASE}/pmaindet2.php?EncHid={enc}&Enc=&userName="


# ── 1. Session + CAPTCHA ─────────────────────────────────────────

def start_session() -> dict:
    """Open a CTRI search session. Returns {"session": token, "image": data-URI}."""
    with _client() as c:
        try:
            page = c.get(_FORM_URL)
            img = c.get(_CAPTCHA_URL, headers={"Referer": _FORM_URL})
        except httpx.HTTPError as exc:
            raise CTRIError(f"CTRI is not reachable ({exc.__class__.__name__}).") from exc
        form = dict(re.findall(r'name="(csrf_token|__ncforminfo)"\s+value="([^"]*)"', page.text))
        if "csrf_token" not in form or not img.content:
            raise CTRIError("CTRI's search page has changed — could not read its form.")
        state = {"cookies": dict(c.cookies), "form": form}
    token = base64.urlsafe_b64encode(json.dumps(state).encode()).decode()
    mime = img.headers.get("content-type", "image/png").split(";")[0]
    return {"session": token, "image": f"data:{mime};base64,{base64.b64encode(img.content).decode()}"}


def _load_session(token: str) -> dict:
    try:
        state = json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        assert isinstance(state.get("cookies"), dict) and isinstance(state.get("form"), dict)
        return state
    except Exception as exc:  # noqa: BLE001 - any garbage token is the same error
        raise CTRICaptchaError("The CTRI session is invalid — load a new code.") from exc


# ── 2. Search (one CAPTCHA) ──────────────────────────────────────

def _text(cell: str) -> str:
    """HTML cell -> plain text, with <br> kept as newlines."""
    cell = re.sub(r"<br\s*/?>", "\n", cell, flags=re.I)
    cell = html.unescape(re.sub(r"<[^>]+>", "", cell)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in cell.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def search(session: str, captcha: str, keyword: str) -> list[dict]:
    """Run one CTRI search. Returns the trials, newest first:
    [{trial_id, ctri_no, title, study_type, status, condition, sites, url}]."""
    state = _load_session(session)
    data = {name: "0" for name in _ALL_FIELDS}
    data.update(stid="0", btt="Search", searchword=keyword.strip(), T9=(captcha or "").strip(),
                **state["form"])
    with _client(state["cookies"]) as c:
        try:
            res = c.post(_SEARCH_URL, data=data, headers={"Referer": _FORM_URL})
        except httpx.HTTPError as exc:
            raise CTRIError(f"CTRI search failed ({exc.__class__.__name__}).") from exc
    body = res.text
    if "Invalid Security Code" in body[:5000]:
        raise CTRICaptchaError("That code didn't match — load a new one and try again.")

    trials = {}
    for row in re.findall(r"<tr onmouseover.*?</tr>", body, flags=re.S | re.I):
        tid = re.search(r'name="chk\[\]"\s+value="(\d+)"', row)
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S | re.I)]
        if not tid or len(cells) < 7:
            continue
        trial_id = int(tid.group(1))
        status = cells[3]
        india = re.search(r"Indian:\s*(.+)", status)
        trials[trial_id] = {
            "trial_id": trial_id,
            "ctri_no": cells[0].strip(),
            "title": cells[1],
            "study_type": cells[2],
            "status": (india.group(1) if india else status).strip(),
            "condition": cells[4],
            "sites": [s.strip() for s in cells[6].split("\n") if s.strip()],
            "url": detail_url(trial_id),
        }
    if not trials and "Search Result" not in body[:3000]:
        raise CTRIError("CTRI returned an unexpected page — try again.")
    return sorted(trials.values(), key=lambda t: t["trial_id"], reverse=True)


# ── 3. Trial detail pages (public) ───────────────────────────────

_STATE_NAMES = {
    "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHHATTISGARH", "GOA", "GUJARAT",
    "HARYANA", "HIMACHAL PRADESH", "JHARKHAND", "KARNATAKA", "KERALA", "MADHYA PRADESH",
    "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND", "ODISHA", "ORISSA", "PUNJAB",
    "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH", "UTTARAKHAND",
    "WEST BENGAL", "DELHI", "CHANDIGARH", "PUDUCHERRY", "PONDICHERRY", "JAMMU & KASHMIR",
    "JAMMU AND KASHMIR", "LADAKH", "ANDAMAN AND NICOBAR ISLANDS", "LAKSHADWEEP",
    "DADRA AND NAGAR HAVELI", "DAMAN AND DIU", "DADRA & NAGAR HAVELI AND DAMAN & DIU",
}
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PIN_RE = re.compile(r"\b(\d{6})\b")


def _row_value(block: str, label: str) -> str:
    m = re.search(rf"<b>\s*{label}\s*(?:&nbsp;)?\s*</td>\s*<td[^>]*>(.*?)</td>", block, flags=re.S | re.I)
    return _text(m.group(1)) if m else ""


def _between(body: str, start: str, end: str) -> str:
    i = body.find(start)
    if i < 0:
        return ""
    j = body.find(end, i + len(start))
    return body[i:j if j > 0 else len(body)]


def _place(lines: list[str]) -> dict:
    """Pick city / state / PIN out of CTRI's address lines (street…, city, STATE, PIN, country)."""
    state = next((ln for ln in lines if ln.upper() in _STATE_NAMES), None)
    pin = next((m.group(1) for ln in lines for m in [_PIN_RE.search(ln)] if m), None)
    city = None
    if state:
        i = lines.index(state)
        if i > 0 and not _PIN_RE.fullmatch(lines[i - 1]):
            city = lines[i - 1]
    return {
        "city": city.title() if city else None,
        "state": state.title() if state else None,
        "postal_code": pin,
    }


def _phones(text: str) -> list[str]:
    out = []
    for part in re.split(r"[\n,/;]", text or ""):
        digits = re.sub(r"\D", "", part)
        if 8 <= len(digits) <= 13 and not set(digits) <= {"0"} and digits not in out:
            out.append(digits)
    return out


def parse_trial(body: str, trial_id: int) -> dict:
    """One trial's detail page -> {ctri_no, title, status, condition, registered, investigators}."""
    ctri_no = re.search(r"CTRI/\d{4}/\d+/\d+", body)
    registered = re.search(r"Registered on:\s*(\d{2}/\d{2}/\d{4})", body)
    # A postgraduate thesis names the student as its investigator — useful, but
    # not the established-investigator signal a sponsored trial is.
    thesis = re.search(r"Post Graduate Thesis\s*(?:&nbsp;)?\s*</td>\s*<td[^>]*>\s*(\w+)", body, flags=re.I)
    title = re.search(r"Public Title of Study</b>.*?</td>\s*<td[^>]*>(.*?)</td>", body, flags=re.S | re.I)
    status = re.search(r"Recruitment Status of Trial \(India\)</b>.*?</td>\s*<td[^>]*>(.*?)</td>",
                       body, flags=re.S | re.I)
    cond_block = _between(body, "Health Condition / Problems Studied", "Intervention / Comparator")
    conditions = re.findall(r"<tr>\s*<td>[^<]*?</td>\s*<td>(.*?)</td>\s*</tr>", cond_block, flags=re.S | re.I)
    trial = {
        "trial_id": trial_id,
        "ctri_no": ctri_no.group(0) if ctri_no else None,
        "title": _text(title.group(1)) if title else None,
        "status": _text(status.group(1)) if status else None,
        "condition": "; ".join(c for c in (_text(x).strip(" ,") for x in conditions) if c) or None,
        "registered": registered.group(1) if registered else None,
        "pg_thesis": bool(thesis and thesis.group(1).lower() == "yes"),
        "url": detail_url(trial_id),
        "investigators": [],
    }

    # Principal investigator / overall trial coordinator.
    pi = _between(body, "Details of Principal Investigator", "Details of Contact Person")
    name = _row_value(pi, "Name")
    if name and name.upper() not in ("NIL", "NA"):
        address = _row_value(pi, "Address").split("\n")
        affiliation = _row_value(pi, "Affiliation")
        trial["investigators"].append({
            "name": name,
            "role": "PI",
            "designation": _row_value(pi, "Designation") or None,
            "institution": affiliation or (address[0].split(",")[1].strip()
                                           if address and address[0].count(",") >= 1 else None),
            "address": ", ".join(address) or None,
            "email": (_EMAIL_RE.search(_row_value(pi, "Email")) or [None])[0],
            "phones": _phones(_row_value(pi, "Phone")),
            **_place(address),
        })

    # One row per site: PI name, site name, address, phone/fax/email.
    sites = _between(body, "Sites of Study", "Details of Ethics Committee")
    for row in re.findall(r"<tr>\s*(<td>.*?)</tr>", sites, flags=re.S | re.I):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S | re.I)]
        if len(cells) < 4 or not cells[0] or "Name of Principal" in cells[0]:
            continue
        address = cells[2].split("\n")
        if address:
            address[0] = re.sub(r",?\s*-\s*(\d{6})$", r", \1", address[0])
        contact = cells[3]
        trial["investigators"].append({
            "name": cells[0],
            "role": "Site PI",
            "designation": None,
            "institution": cells[1] or None,
            "address": ", ".join(address) or None,
            "email": (_EMAIL_RE.search(contact) or [None])[0],
            "phones": _phones(_EMAIL_RE.sub("", contact)),
            **_place(address),
        })
    return trial


def fetch_trial(trial_id: int, client: Optional[httpx.Client] = None) -> Optional[dict]:
    own = client is None
    c = client or _client()
    try:
        res = c.get(detail_url(trial_id))
        if res.status_code != 200 or "message.php?id=invalid" in res.text[:2000]:
            return None
        return parse_trial(res.text, trial_id)
    except httpx.HTTPError as exc:
        logger.info("CTRI trial %s fetch failed: %s", trial_id, exc)
        return None
    finally:
        if own:
            c.close()


def fetch_trials(trial_ids: list[int], workers: int = 6) -> list[dict]:
    """Detail pages for several trials, a few at a time. Unreadable ones are dropped."""
    if not trial_ids:
        return []
    with _client() as c, ThreadPoolExecutor(max_workers=workers) as pool:
        found = list(pool.map(lambda tid: fetch_trial(tid, c), trial_ids))
    return [t for t in found if t]


# ── 4. People ────────────────────────────────────────────────────

_TITLE_RE = re.compile(r"^(?:dr|prof|professor|mr|mrs|ms|miss)\b\.?\s*", re.I)


def clean_name(name: str) -> str:
    """'Dr.D.N. Balraj' -> 'D N Balraj'; 'Prof Dr  A Kumar' -> 'A Kumar'."""
    n = re.sub(r"[.,]", " ", name or "").strip()
    while True:
        stripped = _TITLE_RE.sub("", n).strip()
        if stripped == n:
            break
        n = stripped
    return re.sub(r"\s+", " ", n).strip()


def name_tokens(name: str) -> list[str]:
    tokens = re.findall(r"[a-z]+", clean_name(name).lower())
    # A trailing initial ("Manjunath Shenoy M") is the surname-first habit some
    # registrants have — drop it so it doesn't hide the real surname.
    while len(tokens) > 2 and len(tokens[-1]) == 1:
        tokens.pop()
    return tokens


def name_key(name: str) -> str:
    return " ".join(name_tokens(name))


def names_match(a: str, b: str) -> bool:
    """Same person by name: last names agree and the first names agree (or one is
    an initial of the other). 'Dr. Manjunath Shenoy' == 'M Shenoy'."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb or ta[-1] != tb[-1]:
        return False
    if len(ta) == 1 or len(tb) == 1:
        return False   # a bare surname is too weak to merge on
    fa, fb = ta[0], tb[0]
    return fa == fb or (len(fa) == 1 and fb.startswith(fa)) or (len(fb) == 1 and fa.startswith(fb))


def _trial_ref(trial: dict, role: str) -> dict:
    return {k: trial.get(k) for k in ("ctri_no", "trial_id", "title", "status", "condition",
                                      "registered", "pg_thesis", "url")} | {"role": role}


def group_investigators(trials: list[dict]) -> list[dict]:
    """Fold every investigator across `trials` into one record per person,
    most trials first. Contact fields keep the first non-empty value seen
    (trials arrive newest first, so that is the most recent)."""
    people: list[dict] = []
    for trial in trials:
        for inv in trial["investigators"]:
            key = name_key(inv["name"])
            if not key:
                continue
            email = (inv.get("email") or "").lower()
            # Same person: same name (allowing initials), or the same email.
            p = next((q for q in people if names_match(q["name"], inv["name"])
                      or (email and email in q["emails"])), None)
            if p is None:
                p = {"name": clean_name(inv["name"]), "key": key, "trials": [], "phones": [],
                     "emails": set()}
                people.append(p)
            if email:
                p["emails"].add(email)
            if any(t["trial_id"] == trial["trial_id"] for t in p["trials"]):
                # PI and site PI of the same trial — keep the stronger role.
                if inv["role"] == "PI":
                    for t in p["trials"]:
                        if t["trial_id"] == trial["trial_id"]:
                            t["role"] = "PI"
            else:
                p["trials"].append(_trial_ref(trial, inv["role"]))
            for f in ("designation", "institution", "address", "email", "city", "state", "postal_code"):
                if not p.get(f) and inv.get(f):
                    p[f] = inv[f]
            p["phones"] += [ph for ph in inv["phones"] if ph not in p["phones"]]
    out = people
    for p in out:
        p["emails"] = sorted(p["emails"])
        p["trial_count"] = len(p["trials"])
        p["pi_count"] = sum(1 for t in p["trials"] if t["role"] == "PI")
        p["thesis_only"] = all(t.get("pg_thesis") for t in p["trials"])
    # Investigators of sponsored / institutional trials first, then by volume;
    # people whose only trials are their own PG thesis go last.
    out.sort(key=lambda p: (not p["thesis_only"], p["trial_count"], p["pi_count"]), reverse=True)
    return out


def summary(trials: list[dict]) -> dict:
    """The `ctri_data` payload stored on a KOL row."""
    return {
        "trial_count": len(trials),
        "pi_count": sum(1 for t in trials if t.get("role") == "PI"),
        "trials": trials,
    }


def merge_trials(existing: list[dict], new: list[dict]) -> list[dict]:
    seen = {t.get("ctri_no") or t.get("trial_id"): t for t in existing}
    for t in new:
        seen[t.get("ctri_no") or t.get("trial_id")] = t
    return sorted(seen.values(), key=lambda t: t.get("trial_id") or 0, reverse=True)


def best_phone(phones: list[str]) -> Optional[str]:
    """A mobile if there is one (10 digits from 6-9, optionally 91-prefixed), else the first number."""
    for ph in phones:
        bare = ph[-10:]
        if len(ph) in (10, 12) and bare[0] in "6789":
            return bare
    return phones[0] if phones else None


def apply_to_row(row, people: list[dict]) -> bool:
    """Record what CTRI knows about `people` (one person, possibly listed under
    slightly different names) on a KOL / pending row: merge their trials into
    `ctri_data`, and fill contact / institution / place fields that are blank —
    never overwrite what someone typed. Returns True when anything was found."""
    from datetime import datetime   # local: this module is otherwise model-free

    if not people:
        return False
    old = (row.ctri or {}).get("trials", []) if hasattr(row, "ctri") else []
    trials = old
    for p in people:
        trials = merge_trials(trials, p["trials"])
    row.ctri_data = json.dumps(summary(trials))
    row.ctri_updated_at = datetime.utcnow()
    if not getattr(row, "ctri_key", None):
        row.ctri_key = people[0]["key"][:300]   # links the KOL to its saved CTRI record

    first = lambda field: next((p.get(field) for p in people if p.get(field)), None)  # noqa: E731
    if not row.email and first("email"):
        row.email = first("email")
    if not row.contact_no:
        phone = best_phone([ph for p in people for ph in p.get("phones", [])])
        if phone:
            row.contact_no = phone
    if not row.institution and first("institution"):
        row.institution = first("institution")[:255]
    if not row.designation and first("designation"):
        row.designation = first("designation")[:255]
    if not row.state_city:
        place = ", ".join(x for x in (first("city"), first("state")) if x)
        if place:
            row.state_city = place[:255]
    if not row.geographic_zone:
        row.geographic_zone = "India"
    return True
