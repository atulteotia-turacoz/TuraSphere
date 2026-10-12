## Find KOLs — Pending Verification paging + filters (2026-10-09)

Pending Verification could hold tens of thousands of rows after the bulk scrape import, and the panel loaded every one of them. It now loads 100 at a time with Previous/Next. A filter row under the status buttons narrows by name/email/institution search, source, therapeutic area and country; the dropdowns show a count for each value. "Select all" applies to the current page. The Find KOLs badge fetches only the count. Added Papua New Guinea to the country list.

| File | Change |
|---|---|
| `frontend/src/pages/KOLScrapePanel.js` | `PendingPanel`: `page`/`total`, `narrow` filters, debounced search, facets from `getPendingKOLFacets`, pager. Constants `PENDING_PAGE_SIZE` and `PENDING_SOURCE_LABELS`. |
| `frontend/src/pages/FindKOLsTab.js` | Pending badge calls `listPendingKOLs('pending', { limit: 1 })`. |
| `frontend/src/services/api.js` | `listPendingKOLs(status, params)` passes paging/filter params. New `getPendingKOLFacets(status)`. |
| `frontend/src/utils/countries.js` | Added 'Papua New Guinea'. |

