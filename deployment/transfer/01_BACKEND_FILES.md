## Find KOLs — Directory charts / Top KOLs ranking (2026-10-08)

New `GET /kol-directory/insights` (same filters as the list) for the Directory's Charts view. Ranks KOLs with the Assessment's own `ScoringEngine` thresholds for the criteria public data can fill — C.3 publication volume (max 4), C.4 years of experience (max 4), C.5 publication velocity (3), C.7 trials led incl. CTRI PI (3), C.8 guideline authorship (3) = max 17; ties by papers, trials, experience. Also returns coverage (enriched / with contact / avg experience), score bands and counts by therapeutic area / specialty / city. No schema change.

| File | Change |
|---|---|
| `backend/app/services/kol_ranking.py` | **New.** `score_kol`, `insights`. |
| `backend/app/api/endpoints/kol_directory.py` | `GET /insights` endpoint (declared before `/{entry_id:int}`). |

## Find KOLs — PubMed and ClinicalTrials.gov as scrape sources (2026-10-08)

Two new "How to find them" methods in the Scrape modal, run in parallel with the others:
- **PubMed** (`use_pubmed`): authors of the last 5 years' papers on the Specialty + the Therapeutic Area's keywords, whose OWN affiliation names the City (else the State). Animal-only studies and veterinary / agriculture / pharmacy-college affiliations are dropped; initials-only names skipped. Email from "Electronic address: …". Contactable authors first, then by paper count.
- **ClinicalTrials.gov** (`use_ctgov`): officials whose affiliation is in the place (or names only the country / a local site's facility), site contacts at sites in the place, and central contacts of all-domestic trials — with email + phone. Sponsor desks ("Toll Free Number", pharma names) and foreign-ccTLD emails dropped. "New Delhi" is searched as "Delhi" (the registry's location search is literal).

Identity is a person+place search link stored in `web_profile_url` (like Google), so duplicates are flagged and skipped; `source` = `pubmed` / `ctgov` (fits `String(20)`). Same-name candidates already found on Practo/Google are dropped but hand over their email/phone. No title "Dr." is assumed for these sources. No schema change.

| File | Change |
|---|---|
| `backend/app/services/research_kols.py` | **New.** `pubmed_candidates`, `ctgov_candidates` and helpers. |
| `backend/app/schemas/kol_pending.py` | `ScrapeCriteria.use_pubmed`, `use_ctgov`; source comments. |
| `backend/app/api/endpoints/kol_scrape.py` | Jobs for both sources (pool → 6 workers), `_SOURCE_LABELS`, `_WEB_SOURCES` for already-known flagging + submit identity, contact hand-over to same-name candidates, approve note "From PubMed / From ClinicalTrials.gov". |

## Find KOLs — contacts also from PubMed, ClinicalTrials.gov and X, in parallel; PubMed key fix (2026-10-08)

The first contact lookup (page + web search) filled few emails. Each KOL is now also checked, in parallel, on PubMed (the author's own affiliation "Electronic address: …" — same surname + first name, affiliation naming their place), ClinicalTrials.gov (a central / site contact with the same full name at a site in their place) and X (bio, then the website linked on the profile; handle from the row or from the name search, only with the account's/platform bearer token — stops for the run on 402/429). Per field the order is: saved text → row's page → PubMed → CT.gov → X → search pages → snippets. The switchboard rule (a value on 3+ KOLs is dropped) now also counts values already saved on other rows.

**Bug fixed:** `pubmed_credentials()` returned the stored PubMed key as-is; the local key is `enc::…` ciphertext that doesn't decrypt with this server's secret, so NCBI answered every call "API key invalid" (this also broke PubMed enrichment). It now decrypts the key and, if that fails, goes keyless with a warning in the log. **On live: check the PubMed key in super admin — re-enter it if the log shows "PubMed API key … can't be decrypted".** (`ai_configurations.api_key` is also stored `enc::` locally — not touched here.) No schema change.

| File | Change |
|---|---|
| `backend/app/services/contact_finder.py` | Added `_pubmed_hits`, `_ctgov_hits`, `_x_user` / X hits, `_ncbi_get` (429 retry); `find_contact` now returns all hits best-first and runs sources with `asyncio.gather`; `page_contacts(own=…)` for an X-linked site; `find_contacts` picks first surviving email / phone and tallies `by_source`. |
| `backend/app/services/kol_enrichment_jobs.py` | `pubmed_credentials()` decrypts the key; undecryptable → keyless. |

## Find KOLs — email & contact no. looked up after every scrape (2026-10-08)

Scraped KOLs reached Pending Verification with blank email / phone: Practo masks them, X has no such field, and Google snippets rarely include them (all 192 local pending rows had none). Now, right after candidates are submitted, a background job reads each doctor's own page (`web_profile_url`) and, failing that, web-searches them by name + city (own SerpAPI key → platform key → free fallback) and takes the published email / phone. A list page only yields contacts next to the doctor's name. Where it came from is appended to `notes`. No schema change — uses the existing `email` / `contact_no` columns.

| File | Change |
|---|---|
| `backend/app/services/contact_finder.py` | **New.** `find_contact` (per row) / `find_contacts` (background worker): mailto/tel links, Cloudflare-protected emails, Indian mobile regex, near-name rule on list pages. |
| `backend/app/api/endpoints/kol_scrape.py` | `POST /pending/bulk` now queues `_after_submit` (contacts, then enrichment). New `POST /kol-directory/pending/find-contacts` (`{ids, use_search}`) to (re)run it for selected rows. |
