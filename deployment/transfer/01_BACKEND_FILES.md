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

## Meeting recordings — egress writes to a folder deploys never replace (2026-10-14)

Recording meeting 19 failed with `open /out/tq-meeting-19-….mp4: no such file or directory`. The egress container mounted `./backend/uploads/meetings/livekit` at `/out`. That folder is inside `backend/`, which deploys replace. Docker ties a bind mount to the folder that existed when the container started, so after a deploy egress keeps writing into the deleted copy. Every recording then fails until egress is restarted. Egress now writes to the live `UPLOAD_DIR`, which deploys never touch. No code or schema change.

**On the server, once:**
```bash
mkdir -p /var/www/turaquant/uploads/meetings/livekit
# 1. root .env (next to docker-compose.yml):
#      EGRESS_OUT_DIR=/var/www/turaquant/uploads/meetings/livekit
# 2. docker-compose.yml, egress volumes, replace the /out line with:
#      - ${EGRESS_OUT_DIR:-./backend/uploads/meetings/livekit}:/out
# 3. /var/www/turaquant/backend/.env:
#      EGRESS_HOST_DIR=/var/www/turaquant/uploads/meetings/livekit
docker compose up -d egress            # recreates egress on the new folder
sudo systemctl restart turaquant-backend
bash infra/egress-diag.sh              # section 2b: WRITABLE, host and container inodes match
```
Older recordings in `backend/uploads/meetings/livekit` still play, because the API checks that folder as well.

| File | Change |
|---|---|
| `docker-compose.yml` (git-ignored, edit the server copy by hand) | egress `/out` mount is `${EGRESS_OUT_DIR:-./backend/uploads/meetings/livekit}`. |
| `.env` (root) | `EGRESS_OUT_DIR=/var/www/turaquant/uploads/meetings/livekit`. |
| `backend/.env.production` | `EGRESS_HOST_DIR=/var/www/turaquant/uploads/meetings/livekit`. |
| `deployment/LIVEKIT_PRODUCTION.md` | §5.2 documents the egress output folder. |

## Meeting recordings — long recordings stream instead of downloading whole (2026-10-14)

Play on a long recording showed "Could not load the recording.". The browser downloaded the whole MP4 before it started playing, and the request gave up after 2 minutes. Play now gets a signed link for that one recording, which lasts 6 hours. The `<video>` element streams from it with Range requests, so playback starts at once and seeking works. No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/meeting_transcripts.py` | New `POST /meetings/{id}/recording/{rid}/play-link` (organizer only, checks the file exists, returns a token valid for 6 h). New `GET /meetings/{id}/recording/{rid}/play?t=…[&download=true]`, no header auth: the token must match this recording, and the user must still be active and still the organizer. `/stream` is unchanged; it shares the new `_recording_path_or_404` / `_recording_file_response` helpers. |
| `backend/app/core/security.py` | `get_current_user` rejects tokens that carry `typ` (play links, client-portal sessions). A link copied from a log can't be used to log in. |


## Client portal — Join meeting link (2026-10-14)

The client dashboard had no way to join the meeting. The client is not a meeting participant, so they had no join link, and a LiveKit meeting has no external URL. No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/client_portal.py` | `GET /public/client/{token}`: each meeting now also returns `joinable`, `video_provider` and `join_url` (only while scheduled/live). New `POST /public/client/{token}/meetings/{meeting_id}/livekit/token`: goes through the password gate, the meeting must belong to the client's board and be joinable. Identity `client-{id}`, role `client`. Mic/camera allowed; no screen share, room admin or recording. |

## Meeting room — KOLs show as "Guest" (2026-10-14)

KOLs who joined the LiveKit room through their join link showed up as "Guest" with a "G" avatar. The token took the name only from a linked platform user. KOLs are linked through `hcp_id` / `board_kol_id`, so they had no name. No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/meeting_livekit.py` | `POST /public/meeting/join/{token}/livekit/token` gets the display name from `_participant_identity` (the resolver chat and the roster use). It falls back to the email, then "Guest". |

## Client meeting room — name and chat panel (2026-10-14)

No schema change. Client chat rows have neither `user_id` nor `participant_id`; `sender_role` is `client`.

| File | Change |
|---|---|
| `backend/app/api/endpoints/client_portal.py` | Client LiveKit display name is now just the client's name (it was "Name (Client)", which made the avatar "A("). New `GET` / `POST /public/client/{token}/meetings/{meeting_id}/chat`: same chat thread as the room, password-gated, meeting must be on the client's board. New helper `_client_meeting_or_404`. |

## Client meeting room — screen share + polls (2026-10-14)

No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/client_portal.py` | Client LiveKit token now includes screen share (`can_present=True`), so the client can present slides. Still no room admin or recording. New `GET /public/client/{token}/meetings/{meeting_id}/polls`: the meeting's linked polls with questions, per-option tallies and total votes. Uses `_get_questions` / `_compute_tallies` from `polls.py`. |

## Document preview — PPT design mismatch (2026-10-14)

PowerPoint previews looked different from the deck. LibreOffice only had its own fonts, so Trebuchet MS and Aptos were drawn in Linux Libertine (a serif) and the text reflowed. Conversions now get the fonts in `PREVIEW_FONTS_DIR` (default `backend/fonts`), placed in the conversion profile's `user/fonts`. No schema change.

| File | Change |
|---|---|
| `backend/app/services/document_preview.py` | `_install_fonts()` symlinks every .ttf/.otf/.ttc from the fonts folder into each conversion's profile. The cache key now includes `_CONVERTER_VERSION` ("2") and the font list, so old previews re-render. |
| `backend/app/core/config.py` | New `PREVIEW_FONTS_DIR` (blank = `backend/fonts`). |
| `backend/fonts/README.md` | New. How to fill the folder on Mac and on Linux. |
| `.gitignore` | Font files in `backend/fonts/` are ignored (licensed). |

**Live server steps:**
1. `sudo apt install ttf-mscorefonts-installer fonts-crosextra-carlito fonts-crosextra-caladea && sudo fc-cache -f`
2. Copy `Aptos*.ttf` into `backend/fonts/`. They come with Office, or download them from Microsoft.
3. Restart the API.

## Client meeting room — During Meeting documents (2026-10-14)

The Documents tab in the client's room was empty because it required `client_visible`, and the During Meeting decks are usually shared only with KOLs. The room now lists every enabled `during` document of the meeting, whatever `client_visible` says. That flag still controls the dashboard's Documents tab. No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/client_portal.py` | New `GET /public/client/{token}/meetings/{meeting_id}/room-documents` and `GET …/room-documents/{document_id}/preview`. Password-gated, the meeting must be on the client's board, the document must be phase `during` and enabled. The preview converts Office files to PDF and falls back to the original file. |

## Meeting invites — join code in the participant list (2026-10-14)

No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/meetings.py` | The participant serializer (organizer-side list) now also returns `access_code`. |

## Document preview — LibreOffice version in the cache key (2026-10-15)

On live, previews still had shapes in the wrong place (the swirl lines on the speaker slides ran through the text). The same deck converts correctly with LibreOffice 26.8 locally. Older LibreOffice versions place freeform/rotated shapes wrongly. Previews now regenerate when LibreOffice is upgraded. No schema change.

| File | Change |
|---|---|
| `backend/app/services/document_preview.py` | New `_soffice_version()` (`soffice --version`, read once per process). It is part of the preview cache key. |

**Live server steps (Ubuntu):** upgrade LibreOffice from the official PPA, then restart the API:
`sudo add-apt-repository -y ppa:libreoffice/ppa && sudo apt update && sudo apt install -y libreoffice-impress libreoffice-writer libreoffice-calc`

## Transcription — "open() got an unexpected keyword argument 'metadata_errors'" (2026-10-15)

faster-whisper 1.0.x calls `av.open(..., metadata_errors="ignore")`, and PyAV 14 removed that argument, so every local transcription failed on a fresh server install. faster-whisper 1.1+ no longer passes it. No code or schema change.

| File | Change |
|---|---|
| `backend/requirements.txt` | `faster-whisper>=1.0.0` → `faster-whisper>=1.1.1`. |

**Live server steps:** `cd /home/turaquant/app/backend && source venv/bin/activate && pip install -U "faster-whisper>=1.1.1"`, then restart the API.

## Meeting document upload froze the whole API (Cloudflare "invalid or incomplete response") (2026-10-23)

`POST /meetings/{id}/documents` was an `async def` but emails the board team synchronously over SMTP (`board_notify.notify_board` → one connection per recipient, 20s timeout each). Running on the event loop of the single uvicorn worker, that froze every request for every user (~90s on live, 05:32:37–05:34:05 UTC), and the browser surfaced Cloudflare's error. Made it a plain `def` so FastAPI runs it in a thread. No schema change.

| File | Change |
|---|---|
| `backend/app/api/endpoints/meeting_documents.py` | `upload_meeting_document`: `async def` → `def`; `await file.read()` → `file.file.read()`. |

**Live server steps:** copy the file, then `sudo systemctl restart turasphere`.

## Board notification emails sent in the background (2026-10-23)

`board_notify.notify_board` (document added/shared, meeting start/end, minutes, engagements, stage changes) now resolves recipients in the request and sends from a daemon thread with its own DB session, so a slow or unreachable SMTP server never holds up the request. Results still land in `email_logs`. Direct one-off sends (KOL invite, test email, board emails) stay synchronous so the UI can show their outcome. No schema change.

| File | Change |
|---|---|
| `backend/app/services/board_notify.py` | `notify_board` hands `send_email_bulk` to a background thread (`_send_in_background`); returns the number of recipients queued. |

**Live server steps:** copy the file, then `sudo systemctl restart turasphere`.

## Meetings — TURN relay on 443 so external clients / KOLs can join LiveKit meetings (2026-10-28)

Internal users joined fine. Clients and KOLs on other organisations' networks got "could not establish connection". Their firewalls allow only 443 out, so signalling worked but media on UDP 7892 / TCP 7891 never connected. LiveKit's built-in TURN is now on, and nginx shares public 443 between the websites and TURN by reading the TLS hostname (SNI). No backend code or schema change: LiveKit sends the TURN details to browsers itself.

**On the server:** follow `deployment/LIVEKIT_PRODUCTION.md` §12 in order (DNS `turn.turasphere.com` grey cloud, CloudPanel cert, preflight, firewall 3478/udp + 30000-30200/udp, LiveKit recreate, nginx switch, CloudPanel vhost sync, verify). **Every HTTPS vhost on the box moves from `listen 443 ssl` to `listen 127.0.0.1:10443 ssl proxy_protocol`.** Any site CloudPanel creates later must be edited the same way, or nginx fails to reload.

| File | Change |
|---|---|
| `infra/livekit.yaml` | New `turn:` block: `domain: turn.turasphere.com`, `tls_port: 5349`, `external_tls: true` (nginx terminates TLS), `udp_port: 3478`, relay range 30000-30200. |
| `docker-compose.yml` (git-ignored, edit the server copy by hand) | livekit ports: `127.0.0.1:5349:5349`, `3478:3478/udp`, `30000-30200:30000-30200/udp`. |
| `deployment/nginx/stream-443.conf` | **New.** Goes to `/etc/nginx/stream.d/turaquant-443.conf`, included from the top level of `nginx.conf`. Public 443: SNI `turn.` → TLS termination → LiveKit 5349; everything else → `127.0.0.1:10443` with PROXY protocol. |
| `deployment/nginx/turaquant.cloudpanel.conf` | `listen 443 ssl` / `[::]:443 ssl` replaced by `listen 127.0.0.1:10443 ssl proxy_protocol`, `set_real_ip_from 127.0.0.1`, `real_ip_header proxy_protocol`, `port_in_redirect off`. |
| `infra/turn-preflight.sh` | **New.** Read-only server check: nginx stream modules, every 443 listener, clashing real_ip/allow/deny, free ports, DNS, certificate. |
| `deployment/LIVEKIT_PRODUCTION.md` | New §12 (runbook + rollback). §9 troubleshooting rows and §11 open item updated. |

## Meetings — LiveKit / TURN hostnames moved to turasphere.com (2026-10-29)

The live app is `turasphere.com`, with LiveKit at `wss://livekit.turasphere.com` (server v1.13.9, TURN `turn.turasphere.com` on 443 + UDP 3478). The old `livekit.turaquant.turacoz.com` runs v1.10.1 **without TURN**, so a backend pointing there gives browsers no relay: external clients / KOLs, and any `?relay=1` test, fail with "could not establish pc connection". No code or schema change.

**On the server:** `LIVEKIT_URL=wss://livekit.turasphere.com` in the backend `.env`, then restart the backend. If Account → Meeting Platforms → LiveKit has a URL saved, it overrides `.env`: clear it or set the same URL.

| File | Change |
|---|---|
| `backend/.env`, `backend/.env.production` | `LIVEKIT_URL=wss://livekit.turasphere.com`. |
| `infra/livekit.yaml` | `turn.domain: turn.turasphere.com`. |
| `deployment/nginx/stream-443.conf` | SNI map and certificate paths use `turn.turasphere.com`. |
| `deployment/nginx/turaquant.cloudpanel.conf` | `server_name turasphere.com`; LiveKit vhost reference `livekit.turasphere.com`. |
| `docker-compose.yml` (git-ignored, edit the server copy by hand) | `livekit/livekit-server:v1.13.9`, matching the live server. |
| `infra/turn-preflight.sh`, `infra/livekit-diag.sh` | TURN host `turn.turasphere.com`; run-from path is now "the folder with docker-compose.yml" instead of the old turacoz path. |
| `deployment/LIVEKIT_PRODUCTION.md` | All app / LiveKit / TURN hostnames use `turasphere.com`. §12 finds the compose folder from the running LiveKit container instead of a hard-coded path. |

## Surveys — Net Promoter Score (NPS) question type (2026-10-30)

New `nps` question type: respondents pick 0-10, and the results show the score (% promoters 9-10 minus % detractors 0-6, from -100 to +100). Only completed responses count. The same calculation feeds the team's Survey Results page and the engagement dashboard (organizer and client portal).

**Schema:** `survey_questions.question_type` gains the ENUM value `nps`. The backend applies this itself on start. **Deploy the backend before the frontend:** until the column is widened, saving a survey with an NPS question fails. The SQL is in `04_DATABASE_QUERIES.sql` if you want to run it by hand.

| File | Change |
|---|---|
| `backend/app/services/survey_nps.py` | **New.** `nps_summary(answers)`: score, total, detractors, passives, promoters and the count per score. Blank or invalid answers are ignored. `score` is `null` when nobody has answered, because 0 is a real result. |
| `backend/app/models/survey.py` | `QuestionType.nps`. |
| `backend/app/main.py` | The startup `question_type` ENUM widening now includes `nps`. |
| `backend/app/api/endpoints/surveys.py` | `GET /surveys/{id}/results` returns a new `nps` list, one entry per NPS question. New `_nps_results` helper. |
| `backend/app/services/meeting_engagement_stats.py` | Engagement survey rows for an NPS question carry an `nps` block. |
| `backend/tests/test_survey_nps.py` | **New.** Band edges, score, 0 as an answer, no answers, invalid answers. |
| `deployment/transfer/fix_missing_columns.sql` | `question_type` ENUM includes `nps`. |
