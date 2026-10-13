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

## Assessment parameters — Excel scoring, score groups, assessment out of 50 (2026-10-13)

Parameter scores now follow `parameters (1).xlsx`. Tiers of one criterion (1-5 / 5-10 / 10+ engagements, PageRank top 10% / 25%, …) are in a **score group** and count together up to the group total, so an HCP who matches several tiers cannot collect each of them. All 48 standard parameters together give a full scale of **50**.

Groups: `C2_SPEAKING` (4), `C3_ARTICLES` (3), `C5_PUBS_PER_YEAR` (3), `C6_NETWORK` (2), `C7_TRIALS` (2), `C8_GUIDELINES` (2), `C10_PRACTO` (1).

**Schema:** two new nullable columns on `assessment_parameters`: `score_group VARCHAR(50)` and `group_max_score FLOAT`. The backend adds them on start; `assessment_parameters.sql` adds them too.

**Data:** run `deployment/transfer/assessment_parameters.sql` (see `04_DATABASE_QUERIES.sql`).

**Existing assessments** keep their stored `final_score` until they are re-assessed or a parameter score is overridden. Both of those re-total with the caps.

| File | Change |
|---|---|
| `backend/app/services/parameter_groups.py` | **New.** `capped_totals` (applies group caps, returns total, max and per-category totals), `param_group_map`, `full_scale` (the "out of" figure: 50 for the standard set). |
| `backend/app/models/assessment_parameter.py` | Columns `score_group`, `group_max_score`. |
| `backend/app/api/endpoints/assessment_parameters.py` | `score_group` / `group_max_score` on every create/update/out schema and the user list/custom endpoints. |
| `backend/app/api/endpoints/assessment.py` | Assessment total and the manual-override re-total use `capped_totals`. `GET /{hcp_id}/parameter-scores` also returns `max_possible`, `category_totals`, and `score_group` / `group_max_score` on each row. |
| `backend/app/main.py` | Startup migration adds the two columns. Default seed list matches the Excel: max scores, groups, and the 2 new parameters `MEDICAL_REGISTRATION_NO`, `GOVERNMENT_ORGANISATION`. |
