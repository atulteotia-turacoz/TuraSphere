"""Find KOLs from research registries: PubMed authors and ClinicalTrials.gov
investigators for a specialty in a place.

Both are research-active people by definition (the KOL signal Practo / Google
lack), and both often publish a contact: a PubMed corresponding author's
affiliation ends "Electronic address: …"; a trial's site / central contact lists
an email and phone.

Place is matched on each PERSON, not just the paper / trial: an author counts
only when their own affiliation names the City / State, an investigator only when
their affiliation (or their trial site) does — a multinational paper or trial
otherwise drags in people from everywhere.

A candidate's identity (saved in `web_profile_url`, like a Google one) is a search
link for that person in that place, so the same person re-scraped is recognised.
"""
import asyncio
import logging
import re
from typing import Dict, List, Optional
from urllib.parse import quote
from xml.etree import ElementTree

import httpx

from app.services.clinical_trials_service import ClinicalTrialsService
from app.services.contact_finder import _clean_email, _clean_phone, _text_contacts
from app.services.pubmed_service import PUBMED_FETCH_URL, PUBMED_SEARCH_URL, default_window

logger = logging.getLogger(__name__)

# Parts of an affiliation that name the institution rather than the department.
_INSTITUTION_HINT = re.compile(
    r"institut|college|hospital|universit|aiims|cent(re|er)|medical|sciences|clinic|foundation|trust", re.I)
_DEPARTMENT_HINT = re.compile(r"\b(department|dept|division|unit|school)\b", re.I)
# Contact "names" that are a sponsor's desk, not a person.
_NOT_A_PERSON = re.compile(
    r"pharma|clinical|trial|study|director|information|call|center|centre|sponsor|transparency|"
    r"disclosure|medical affairs|registry|desk|team|department|hospital|institute|university|"
    r"limited|ltd|inc\b|gmbh|novartis|pfizer|sanofi|roche|lilly|bayer|gsk|astrazeneca|"
    r"boehringer|janssen|merck|abbott|takeda|novo nordisk|biocon|cipla|lupin|zydus|glenmark|"
    r"toll|free|number|physician|interested|contact|please|recruit|enquir|inquir|hotline", re.I)
# Author affiliations that aren't human medicine.
_NOT_CLINICAL = re.compile(
    r"veterinar|agricultur|animal (husbandry|science)|cattle|dairy|fisheries|horticult|college of pharmacy", re.I)
# Country-code TLDs → which country an address belongs to (generic .com/.org pass).
_CC_TLD = re.compile(r"\.([a-z]{2})$")
_COUNTRY_TLD = {"india": "in", "united states": "us", "united kingdom": "uk", "canada": "ca", "australia": "au",
                "singapore": "sg", "united arab emirates": "ae", "germany": "de", "france": "fr", "japan": "jp",
                "south africa": "za"}
# How each registry spells a country, where it differs from the name we store:
# PubMed affiliations say "USA" / "Korea", ClinicalTrials.gov "Korea, Republic of".
_COUNTRY_ALIASES = {
    "united states": ["USA", "United States", "U.S.A"],
    "united kingdom": ["UK", "United Kingdom"],
    "south korea": ["Korea"],
    "czech republic": ["Czech Republic", "Czechia"],
    "czechia": ["Czech Republic", "Czechia"],
    "vietnam": ["Vietnam", "Viet Nam"],
    "united arab emirates": ["United Arab Emirates", "UAE"],
}
# ClinicalTrials.gov's location search is literal — its own spelling of the country.
_CTGOV_COUNTRY = {"south korea": "Korea, Republic of", "czech republic": "Czechia"}
# Places that write the country into their address without being in it
# ("Hong Kong SAR, China", "Taipei, Taiwan, Republic of China").
_COUNTRY_EXCLUDE = {"china": ["Hong Kong", "Taiwan", "Macau", "Macao"]}
_DEGREES = re.compile(r",.*$|\b(MD|MBBS|MS|DM|DNB|PhD|FRCP\w*|MRCP|FACS|FICS|MCh|DGO|MPH)\b\.?", re.I)
_TITLES = re.compile(r"^\s*(dr|prof|professor|mr|mrs|ms)\.?\s+", re.I)


def _places(criteria) -> List[str]:
    """The City when one is set (a State would pull in the whole state), else the State."""
    for p in (criteria.city, criteria.state):
        if (p or "").strip():
            return [p.strip()]
    return []


def _topic(criteria) -> str:
    return (criteria.specialty or criteria.subspecialty or criteria.therapeutic_area or "").strip()


def _terms(criteria, keywords: Optional[List[str]]) -> List[str]:
    """The topic plus the Therapeutic Area's own keywords (Account → Categories):
    registries file work under conditions ("pregnancy", "IVF"), rarely under a
    specialty's name, so the label alone finds little."""
    out, seen = [], set()
    for t in [criteria.specialty, criteria.subspecialty, criteria.therapeutic_area, *(keywords or [])]:
        t = re.sub(r'["()\[\]]', " ", t or "").strip()
        if len(t) >= 3 and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:12]


def _norm(text: str) -> str:
    """'New Delhi' and 'Delhi' are the same place in registry data."""
    return re.sub(r"\bnew\s+", "", (text or "").lower())


def _split_affiliation(aff: str) -> Dict[str, Optional[str]]:
    """'Dept of OBG, AIIMS, New Delhi, India. Electronic address: …' ->
    institution 'AIIMS', department 'Dept of OBG'."""
    aff = re.split(r"electronic address", aff or "", flags=re.I)[0]
    parts = [p.strip(" .;") for p in aff.split(",") if p.strip(" .;")]
    dept = next((p for p in parts if _DEPARTMENT_HINT.search(p)), None)
    inst = next((p for p in parts if p != dept and _INSTITUTION_HINT.search(p)), None)
    if not inst and len(parts) > 1:
        inst = parts[1] if parts[0] == dept else parts[0]
    return {"institution": (inst or "")[:255] or None, "department": (dept or "")[:255] or None}


def _mentions_place(text: str, places: List[str]) -> bool:
    # Whole words only — a bare substring check reads "Women's Hospital" as Oman,
    # "Indiana" as India and "Perugia" as Peru.
    low = _norm(text)
    return any(re.search(rf"\b{re.escape(_norm(p))}\b", low) for p in places if _norm(p).strip())


def _country_names(country: str) -> List[str]:
    return _COUNTRY_ALIASES.get((country or "").strip().lower()) or [country.strip()]


def _in_country(text: str, country: str) -> bool:
    """`text` (an affiliation / site address) is in `country`, under any spelling."""
    if not _mentions_place(text, _country_names(country)):
        return False
    return not _mentions_place(text, _COUNTRY_EXCLUDE.get(country.strip().lower(), []))


# ── PubMed ───────────────────────────────────────────────────────

def pubmed_candidates(criteria, notes: List[str], api_key: str = "",
                      keywords: Optional[List[str]] = None) -> List[Dict]:
    """Authors of recent papers on the topic whose own affiliation is in the place."""
    topic = _topic(criteria)
    places = _places(criteria)
    country = (criteria.geographic_zone or "").strip()
    if not topic:
        notes.append("PubMed skipped — pick a Therapeutic Area or Specialty.")
        return []
    if not (places or country):
        notes.append("PubMed skipped — set a City, State or Country to search authors there.")
        return []
    # Affiliation-tagged place narrows the papers; each author is still checked below.
    where = places or _country_names(country)
    topics = " OR ".join(f"({t})" for t in _terms(criteria, keywords))
    term = f"({topics}) AND (" + " OR ".join(f'"{p}"[Affiliation]' for p in where) + ")"
    # Drop animal-only studies (veterinary colleges publish "gynaecology" too) while
    # keeping new papers not yet MeSH-indexed.
    term += " NOT (animals[mh] NOT humans[mh])"
    if places and country:
        term += f' AND "{country}"[Affiliation]'
    min_date, max_date = default_window()
    params = {"db": "pubmed", "term": term, "retmax": min(500, max(150, criteria.limit * 6)),
              "retmode": "json", "sort": "date", "mindate": min_date, "maxdate": max_date,
              "datetype": "pdat"}
    if api_key:
        params["api_key"] = api_key

    people: Dict[str, Dict] = {}
    with httpx.Client(timeout=40) as client:
        r = client.get(PUBMED_SEARCH_URL, params=params)
        r.raise_for_status()
        result = r.json().get("esearchresult", {})
        ids = result.get("idlist", [])
        for i in range(0, len(ids), 200):
            data = {"db": "pubmed", "id": ",".join(ids[i:i + 200]), "retmode": "xml"}
            if api_key:
                data["api_key"] = api_key
            resp = client.post(PUBMED_FETCH_URL, data=data)
            if resp.status_code != 200:
                continue
            for art in ElementTree.fromstring(resp.text).findall(".//PubmedArticle"):
                _collect_authors(art, (lambda a: _mentions_place(a, places)) if places
                                 else (lambda a: _in_country(a, country)), people)
    notes.append(f"PubMed: {result.get('count', 0)} papers on “{topic}” from {', '.join(places or [country])} "
                 f"in the last 5 years — read authors from the newest {len(ids)}.")

    # Contactable first, then the most published.
    ranked = sorted(people.values(), key=lambda p: (not p["email"], -p["count"]))
    out = []
    for p in ranked[:criteria.limit]:
        aff = _split_affiliation(p["affiliation"])
        latest = p["latest"]
        bio = (f"{p['count']} PubMed paper{'s' if p['count'] != 1 else ''} on “{topic}” in the last 5 years"
               f" · latest ({latest['year']}): {latest['title']}")
        place = next((x for x in places if x.lower() in p["affiliation"].lower()), None) or (where[0] if where else "")
        search = quote(f'{p["last"]} {p["fore"]}[Author] AND {place}[Affiliation]')
        out.append({
            "key": f"pubmed:{p['last']} {p['fore']}|{place}".lower(),
            "source": "pubmed",
            "name": f"{p['fore']} {p['last']}",
            "bio": bio[:1000],
            "location": ", ".join(x for x in (criteria.city, criteria.state) if x) or country or None,
            "profile_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={search}",
            "email": p["email"],
            "contact_no": None,
            "specialty": (criteria.specialty or "").strip() or None,
            "institution": aff["institution"],
            "designation": aff["department"],
            "city": (criteria.city or "").strip() or None,
            "state": (criteria.state or "").strip() or None,
            "country": country or None,
            "web_page_title": f"PubMed · latest PMID {latest['pmid']}",
            "discovered_via": f"pubmed:{topic}",
        })
    if ids and not out:
        notes.append("PubMed found papers, but no author with a full first name whose affiliation is in your place.")
    return out


def _collect_authors(art, in_place, people: Dict[str, Dict]) -> None:
    pmid = art.findtext(".//PMID", "")
    title = (art.findtext(".//ArticleTitle") or "").strip()
    year = art.findtext(".//PubDate/Year") or (art.findtext(".//PubDate/MedlineDate") or "")[:4]
    for au in art.findall(".//AuthorList/Author"):
        last = (au.findtext("LastName") or "").strip()
        fore = _TITLES.sub("", (au.findtext("ForeName") or "").strip()).strip()
        # Initials only ("A K") can't tell two people apart — skip.
        if not last or not re.match(r"[A-Za-z]{2,}", fore):
            continue
        affs = " ".join(a.text or "" for a in au.findall(".//AffiliationInfo/Affiliation"))
        if not in_place(affs) or _NOT_CLINICAL.search(affs):
            continue
        key = f"{last} {fore.split()[0]}".lower()
        p = people.setdefault(key, {"last": last, "fore": fore, "count": 0, "email": None,
                                     "affiliation": affs, "latest": {"pmid": pmid, "title": title, "year": year}})
        p["count"] += 1
        if not p["email"]:
            emails = _text_contacts(affs)[0]
            p["email"] = emails[0] if emails else None


# ── ClinicalTrials.gov ───────────────────────────────────────────

def _person(name: str) -> Optional[str]:
    """'Dr. Randeep Guleria, MD' -> 'Randeep Guleria'; None for a sponsor's desk."""
    n = _TITLES.sub("", _DEGREES.sub("", name or "")).strip(" .,")
    n = re.sub(r"\s+", " ", n)
    words = re.findall(r"[A-Za-z]{2,}", n)
    if _NOT_A_PERSON.search(n) or not 2 <= len(words) <= 5 or re.search(r"[\d@]", n):
        return None
    return n


def ctgov_candidates(criteria, notes: List[str], keywords: Optional[List[str]] = None) -> List[Dict]:
    """Investigators and site contacts of trials on the topic, in the place."""
    topic = _topic(criteria)
    places = _places(criteria)
    country = (criteria.geographic_zone or "").strip()
    if not topic:
        notes.append("ClinicalTrials.gov skipped — pick a Therapeutic Area or Specialty.")
        return []
    if not (places or country):
        notes.append("ClinicalTrials.gov skipped — set a City, State or Country.")
        return []
    # The registry's location search is literal: "New Delhi" finds a fifth of what
    # "Delhi" does — search the normalised name.
    locn = ", ".join(re.sub(r"(?i)^new\s+", "", x.strip())
                     for x in (criteria.city or criteria.state, _CTGOV_COUNTRY.get(country.lower(), country))
                     if (x or "").strip())
    cond = " OR ".join(f'"{t}"' if " " in t else t for t in _terms(criteria, keywords))
    svc = ClinicalTrialsService()
    studies: List[Dict] = []
    token = None
    for _ in range(3):   # up to 300 trials
        params = {"query.term": cond, "query.locn": locn, "pageSize": 100, "format": "json"}
        if token:
            params["pageToken"] = token
        data = asyncio.run(svc._fetch_with_httpx(params)) or svc._fetch_with_curl(params)
        studies += data.get("studies", [])
        token = data.get("nextPageToken")
        if not token:
            break
    notes.append(f"ClinicalTrials.gov: {len(studies)} trial{'s' if len(studies) != 1 else ''} on “{topic}” in {locn}.")

    def at_place(text: str) -> bool:
        return _mentions_place(text, places) if places else _in_country(text, country)

    india = (country or "india").lower() == "india"
    people: Dict[str, Dict] = {}

    home_tld = _COUNTRY_TLD.get((country or "india").lower())

    def add(name, nct, title, role, institution, email=None, phone=None, place_text=""):
        n = _person(name)
        if not n:
            return
        tld = _CC_TLD.search((email or "").lower())
        if tld and home_tld and tld.group(1) != home_tld:
            return   # a foreign address on a local site: the sponsor's coordinator abroad
        key = n.lower()
        p = people.setdefault(key, {"name": n, "trials": [], "pi": 0, "email": None, "phone": None,
                                    "institution": None, "place": place_text})
        if nct not in p["trials"]:
            p["trials"].append(nct)
            p.setdefault("latest", {"nct": nct, "title": title})
            if role in ("PRINCIPAL_INVESTIGATOR", "STUDY_CHAIR"):
                p["pi"] += 1
        p["email"] = p["email"] or _clean_email(email or "")
        raw_phone = (phone or "").strip()
        p["phone"] = p["phone"] or _clean_phone(raw_phone) or (raw_phone[:40] if raw_phone and not india else None)
        p["institution"] = p["institution"] or (institution or "")[:255] or None

    for st in studies:
        proto = st.get("protocolSection", {})
        ident = proto.get("identificationModule", {})
        nct, title = ident.get("nctId", ""), ident.get("briefTitle", "")
        cl = proto.get("contactsLocationsModule", {})
        locs = [l for l in cl.get("locations") or []
                if at_place(f"{l.get('city', '')} {l.get('state', '')} {l.get('country', '')}")]
        facilities = [(l.get("facility") or "").lower() for l in locs]
        for o in cl.get("overallOfficials") or []:
            aff = (o.get("affiliation") or "")
            # Their affiliation names the place — or names the country / one of the
            # place's sites while the trial runs there ("Diabetes Foundation, India").
            # Country-only counts only when the affiliation names no city at all — a
            # "…, Chennai, India" investigator on a multi-city trial is not local.
            local = at_place(aff) or (locs and aff and (
                (_in_country(aff, country or "India") and aff.count(",") <= 1)
                or any(f and (aff.lower() in f or f in aff.lower()) for f in facilities)))
            if local:
                add(o.get("name"), nct, title, (o.get("role") or "").upper(),
                    _split_affiliation(aff)["institution"] or aff)
        for l in locs:
            for c in l.get("contacts") or []:
                add(c.get("name"), nct, title, (c.get("role") or "").upper(), l.get("facility"),
                    c.get("email"), c.get("phone"), f"{l.get('city', '')}, {l.get('state', '')}")
        # Central contacts speak for the whole trial — only take them when every
        # site is in the country (a multinational's contact sits abroad).
        all_locs = cl.get("locations") or []
        domestic = all_locs and all(_in_country(l.get("country") or "", country or "India") for l in all_locs)
        if locs and domestic:
            for c in cl.get("centralContacts") or []:
                add(c.get("name"), nct, title, (c.get("role") or "").upper(), None, c.get("email"), c.get("phone"))

    ranked = sorted(people.values(), key=lambda p: (not (p["email"] or p["phone"]), -p["pi"], -len(p["trials"])))
    out = []
    for p in ranked[:criteria.limit]:
        n, pi = len(p["trials"]), p["pi"]
        latest = p["latest"]
        bio = f"{n} trial{'s' if n != 1 else ''} on ClinicalTrials.gov" + (f", {pi} as PI" if pi else "") \
            + f" · latest: {latest['title']} ({latest['nct']})"
        out.append({
            "key": f"ctgov:{p['name']}|{locn}".lower(),
            "source": "ctgov",
            "name": p["name"],
            "bio": bio[:1000],
            "location": locn,
            "profile_url": f"https://clinicaltrials.gov/search?term={quote(p['name'])}&locStr={quote(locn)}",
            "email": p["email"],
            "contact_no": p["phone"],
            "specialty": (criteria.specialty or "").strip() or None,
            "institution": p["institution"],
            "city": (criteria.city or "").strip() or None,
            "state": (criteria.state or "").strip() or None,
            "country": country or None,
            "web_page_title": f"ClinicalTrials.gov · {latest['nct']}",
            "discovered_via": f"ctgov:{topic}",
        })
    if studies and not out:
        notes.append("ClinicalTrials.gov found trials, but no named investigator or contact in your place.")
    return out
