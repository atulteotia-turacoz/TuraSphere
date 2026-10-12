## Find KOLs — bulk scrape of 23 therapeutic areas × 51 countries into a temp table; paged Pending Verification; country matching fixes (2026-10-09)

Bulk run of the Find-KOLs scrape for 23 therapeutic areas × 51 countries (1,173 combos). It uses PubMed and ClinicalTrials.gov everywhere, plus Practo for India where the area maps to a Practo specialty. Google/SerpAPI was left out because it would burn the paid quota, and CTRI because every search needs a hand-typed captcha. Rows go to a new temp table `kol_scrape_import` with `kol_pending`'s columns, so on the server they reach Pending Verification with one `INSERT … SELECT` (see `04_DATABASE_QUERIES.sql`). Data file: `deployment/transfer/kol_scrape_import.sql` (30 MB, 46,824 KOLs).

**Bugs fixed in `research_kols.py`, which also affect normal scrapes:**
- Place matching was a substring check, so "Women's Hospital" counted as Oman, "Indiana" as India and "Perugia" as Peru. It now matches whole words.
- Countries are now searched under the spelling each registry uses:
  - PubMed: "USA" for United States, "Korea" for South Korea, "Czech Republic"/"Czechia", "Viet Nam".
  - ClinicalTrials.gov: "Korea, Republic of", "Czechia".
- China excludes Hong Kong, Taiwan and Macau affiliations.

**Pending list:** `GET /kol-directory/pending` now takes optional `skip`, `limit` (≤1000), `search`, `source`, `therapeutic_area` and `geographic_zone`. Without `limit` it still returns everything, as before. The new `GET /kol-directory/pending/facets` returns per-value counts for the filters. `POST /pending/approve-bulk` now returns only the first 100 rows instead of the whole queue (the panel reloads its own page anyway). No change to `kol_pending`'s schema.

| File | Change |
|---|---|
| `backend/scripts/bulk_kol_scrape.py` | **New.** Subcommands `scrape` (resumable, `--workers`, `--limit`, `--ta`, `--country`, and `--stall-minutes`, a watchdog that exits if no combo finishes for that long so a re-run can resume), `status`, `load-pending --user-id N`, and `dump [--owner-email]`. With `--owner-email` the dump also contains the INSERT into `kol_pending`, so the whole live import is one file. Creates `kol_scrape_import` and `kol_scrape_import_progress`. Not used by the running app; it does not need to be on the server. |
| `backend/app/services/research_kols.py` | Word-boundary `_mentions_place`. New `_COUNTRY_ALIASES`, `_CTGOV_COUNTRY`, `_COUNTRY_EXCLUDE`, `_country_names` and `_in_country`. PubMed searches and checks every spelling of the country; `_collect_authors` takes a matcher. CT.gov uses the registry's country name and `_in_country` for site, official and domestic checks. |
| `backend/app/api/endpoints/kol_scrape.py` | `_pending_scope` and `_pending_page` helpers. `list_pending` gets paging and filters. New `GET /pending/facets`. `approve_bulk` returns the first page. |

