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
