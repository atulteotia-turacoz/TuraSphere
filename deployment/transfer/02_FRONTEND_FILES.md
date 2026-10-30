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

## Meetings — `?relay=1` forces the TURN relay, for testing external access (2026-10-28)

Goes with the TURN-on-443 server change (see `01_BACKEND_FILES.md`, same date). Adding `?relay=1` (or `&relay=1`) to any meeting room or join page URL connects with `iceTransportPolicy: 'relay'`. Media then only goes through TURN, the same path external clients / KOLs on corporate networks use, so it can be tested from the office. Without the flag nothing changes.

| File | Change |
|---|---|
| `frontend/src/pages/advisoryBoards/LiveKitRoom.js` | `room.connect` passes `rtcConfig: { iceTransportPolicy: 'relay' }` when the page URL has `relay=1`. |

## Meetings — every LiveKit participant uses the TURN relay by default (2026-10-29)

Clients and KOLs from other organisations could not join ("could not establish pc connection"): their firewalls drop our direct media ports. Tested with `?relay=1` and it worked, so relay is now the default for **everyone**: internal users, KOLs on the join page and clients in the portal. All media goes through `turns:turn.turasphere.com:443`. `?relay=0` on the page URL tries direct media instead, for debugging. Recordings are unaffected: egress uses its own template page, not this component.

Needs the server fix from `01_BACKEND_FILES.md` (2026-10-29): the backend must hand out `wss://livekit.turasphere.com`. The old `livekit.turaquant.turacoz.com` has no TURN, so with relay forced nobody could join.

| File | Change |
|---|---|
| `frontend/src/pages/advisoryBoards/LiveKitRoom.js` | `room.connect` always passes `rtcConfig: { iceTransportPolicy: 'relay' }` unless the page URL has `relay=0`. |

## Surveys — Net Promoter Score (NPS) question type (2026-10-30)

Goes with the backend change (see `01_BACKEND_FILES.md`, same date). **Deploy the backend first.**

"Net Promoter Score (NPS)" is in the Rating group of the question type picker. Picking it on an empty question fills in the standard wording, which the author can edit. Respondents see 0-10 on one row at every screen width, in one neutral colour so the buttons don't steer the answer. The "Not at all likely" / "Extremely likely" labels follow the survey's language (English, Spanish, French, German). Skip logic works as on other scale questions: one "Any answer" rule.

| File | Change |
|---|---|
| `frontend/src/components/NpsSummary.js` | **New.** Score, share of detractors / passives / promoters, and answers per score. Used by both results views. |
| `frontend/src/pages/SurveyEditPage.js` | NPS in `QUESTION_TYPE_GRID`, `NPS_DEFAULT_LABEL`, label pre-fill in `handleTypeChange`, preview in `QuestionPreview`, note in the Edit tab. |
| `frontend/src/pages/PublicSurveyPage.js` | New `NpsInput`. `npsLow` / `npsHigh` in `UI_STRINGS`. `QuestionRenderer` takes `t`. |
| `frontend/src/pages/SurveyResultsPage.js` | An NPS card above the responses for each answered NPS question. |
| `frontend/src/pages/advisoryBoards/EngagementDashboard.js` | `SurveyResults` shows `NpsSummary` for NPS questions instead of the option list (organizer dashboard and client portal). |

## Polling — images on answer options (2026-10-30)

Each option in the Create and Edit poll forms has an image button: upload, preview, remove. An option can be text, image, or both. An image-only option is saved with the label "Option A", "Option B" and so on, so results, the vote table and the CSV always have a name for it. Editing a poll used to drop any option images; it now keeps them. Images appear on the public poll, in the poll results and in the client portal's live polls. Each sits in a fixed-size box (public poll 140×90, narrower on phones; results 72×40; portal 60×34) and scales to fit it whole, never cropped, so options line up whatever size was uploaded. Frontend only: `polls.questions` already stored `{text, image}`, and upload uses the existing `POST /surveys/upload-image`. No backend or database change.

| File | Change |
|---|---|
| `frontend/src/pages/PollingPage.js` | New `OptionImageButton`. Options are `{text, image}` in form state. New `serializeOptions`, `optionHasContent`, `normalizeOption`. Results show a thumbnail per option. |
| `frontend/src/pages/PublicPollPage.js` | Option image in a fixed box with `object-fit: contain`. |
| `frontend/src/pages/PublicClientPortalPage.js` | `RoomPolls` shows a thumbnail per option. New `resolveImg`. |
