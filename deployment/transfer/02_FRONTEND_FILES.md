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

## Meeting recordings — long recordings stream instead of downloading whole (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/services/api.js` | `getMeetingRecordingBlob` replaced by `getMeetingRecordingPlayUrl(meetingId, recordingId, { download })`. It gets a play link and returns the streaming URL. |
| `frontend/src/pages/advisoryBoards/MeetingDetail.js` | `RecordingRow`: Play sets the `<video src>` to the streaming URL (no blob). The Video button saves the file through a `download=true` link. If the player errors (for example, an expired link) it says so and Play loads a fresh link. |


## Client portal — Join meeting link (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/services/api.js` | New `getClientLiveKitToken(token, meetingId)`. |
| `frontend/src/pages/PublicClientPortalPage.js` | "Join meeting" button in the dashboard's Next meeting card while the meeting is scheduled/live. A LiveKit meeting opens a full-screen in-app room (`LiveKitRoom`) with a Leave button. A Zoom meeting opens its `join_url` in a new tab. |

## Client meeting room — chat panel (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/services/api.js` | New `getClientChat(token, meetingId, afterId)` and `sendClientChat(token, meetingId, body)`. |
| `frontend/src/pages/PublicClientPortalPage.js` | The client's meeting room uses the expert room's layout: Chat panel on the left (`ClientRoomPanel`, using `MeetingChatPanel`), video on the right. |

## Client meeting room — Polls / Surveys / Chat tabs (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/services/api.js` | New `getClientPolls(token, meetingId)`. |
| `frontend/src/pages/PublicClientPortalPage.js` | `ClientRoomPanel` has the organizer's tabs: Polls (live tallies, refreshed every 10 s), Surveys (`SurveyResults` from the engagement payload) and Chat. The video bar shows Share screen because the token now allows it. |

## Client meeting room — Documents tab (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/pages/PublicClientPortalPage.js` | New Documents tab in `ClientRoomPanel` (`RoomDocuments`). It lists this meeting's documents with phase `during` that are shared with the client. Open shows the preview PDF (Office files converted) in a new browser tab, so the client can present it with Share screen. |

## Client meeting room — Documents tab uses room endpoints (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/services/api.js` | New `listClientRoomDocuments(token, meetingId)` and `previewClientRoomDocument(token, meetingId, documentId)`. |
| `frontend/src/pages/PublicClientPortalPage.js` | `RoomDocuments` uses these instead of filtering the client-shared list. |

## Meeting invites & access — copy join code (2026-10-14)

| File | Change |
|---|---|
| `frontend/src/pages/advisoryBoards/MeetingDetail.js` | `ParticipantsSection`: new key button next to Copy link that copies the participant's join code, with a tick when copied. The tooltip shows the code. `ParticipantSettings` (the expanded row) has a "Join code" field with its own Copy button. When there is no code yet, it says the code is created when the invite is sent. |
