## Find KOLs — Pending Verification paging + filters (2026-10-09)

Pending Verification could hold tens of thousands of rows after the bulk scrape import, and the panel loaded every one of them. It now loads 100 at a time with Previous/Next. A filter row under the status buttons narrows by name/email/institution search, source, therapeutic area and country; the dropdowns show a count for each value. "Select all" applies to the current page. The Find KOLs badge fetches only the count. Added Papua New Guinea to the country list.

| File | Change |
|---|---|
| `frontend/src/pages/KOLScrapePanel.js` | `PendingPanel`: `page`/`total`, `narrow` filters, debounced search, facets from `getPendingKOLFacets`, pager. Constants `PENDING_PAGE_SIZE` and `PENDING_SOURCE_LABELS`. |
| `frontend/src/pages/FindKOLsTab.js` | Pending badge calls `listPendingKOLs('pending', { limit: 1 })`. |
| `frontend/src/services/api.js` | `listPendingKOLs(status, params)` passes paging/filter params. New `getPendingKOLFacets(status)`. |
| `frontend/src/utils/countries.js` | Added 'Papua New Guinea'. |

## Assessment results — out of 50 with group caps (2026-10-13)

The results page uses `max_possible` and `category_totals` from `GET /assessments/{hcp_id}/parameter-scores`, so it shows "out of 50" and category totals with tier groups capped. Before, it added up every row's max score, which counted tiers twice. Older API responses without those fields fall back to the previous sums.

| File | Change |
|---|---|
| `frontend/src/pages/ResultsPage.js` | Score meter, "Max Possible", category headers and the PDF export use the capped totals. The default when there are no parameter rows is now 50 instead of 55. |
