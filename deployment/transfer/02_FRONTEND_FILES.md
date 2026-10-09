## Find KOLs — Directory "Charts" view (2026-10-08)

List | Charts switch on the Directory (`?display=charts`, filters + search apply). Charts: research-coverage banner with "Fetch research data (n)", KPI tiles, Top 10 KOLs bar chart (hover = score breakdown, click = open KOL, Table toggle, "How is this scored?"), score distribution, KOLs by therapeutic area / specialty / city. Uses theme tokens, so light + dark both work.

| File | Change |
|---|---|
| `frontend/src/pages/KOLInsights.js` | **New.** The Charts view (recharts). |
| `frontend/src/pages/FindKOLsTab.js` | List / Charts toggle; sort select only in List; renders `KOLInsights` in Charts. |
| `frontend/src/services/api.js` | `getKOLInsights(params)`. |

## Find KOLs — removed the separate "CTRI Data" tab (2026-10-08)

CTRI is one of the Scrape modal's sources, and its KOLs reach Pending Verification / the Directory like every other source — a separate tab duplicated that. `?view=ctri` links now open the Directory. `CTRIDataPanel.js` deleted; backend CTRI endpoints unchanged.

| File | Change |
|---|---|
| `frontend/src/pages/FindKOLsTab.js` | Removed the CTRI Data button, the `ctri` view and the `CTRIDataPanel` import. |
| `frontend/src/pages/CTRIDataPanel.js` | **Deleted** — delete it on the server too. |

## Find KOLs — PubMed and ClinicalTrials.gov scrape options (2026-10-08)

| File | Change |
|---|---|
| `frontend/src/pages/KOLScrapePanel.js` | Two new method checkboxes (on by default), sent as `use_pubmed` / `use_ctgov`; PubMed / ClinicalTrials.gov source badges; "Papers" / "Trials" link labels; submit maps them as web-identity sources with their own `source` and an "Affiliation:" note. |
| `frontend/src/pages/FindKOLsTab.js` | `SOURCE_LABELS` for `pubmed` and `ctgov` in the directory. |

## Find KOLs — contact lookup text mentions all sources (2026-10-08)

| File | Change |
|---|---|
| `frontend/src/pages/KOLScrapePanel.js` | "Find contacts" tooltip and the Details view's blank-contact hint now list PubMed, ClinicalTrials.gov, X and web search. |

## Find KOLs — "Find contacts" in Pending Verification (2026-10-08)

Companion to the backend contact lookup. Selected pending rows missing an email or phone get a **Find contacts (n)** button; the Details view's blank-contact hint now says it was looked up and how to retry.

| File | Change |
|---|---|
| `frontend/src/services/api.js` | Added `findPendingContacts(ids, useSearch)`. |
| `frontend/src/pages/KOLScrapePanel.js` | "Find contacts" bulk button + handler; updated blank-contact text in the Details modal. |
