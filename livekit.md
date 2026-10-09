# LiveKit for TuraQuant — install, isolate, integrate

Plan for giving TuraQuant its own live-conferencing stack alongside Zoom, using
LiveKit. Written 2026-08-05. **Nothing here is implemented yet** — this is the
install and integration plan, plus the traps already paid for once in
TuraClickMeet.

## Why

Zoom's Meeting SDK renders *its* UI in a box, and its features are gated by the
customer's Zoom plan. That is what blocked us: on the current account
(`atul.teotia@turacoz.com`, Zoom type 1 = **Basic/free**) there is no cloud
recording at all, and AI Companion summary is paid — so no code can produce a
Record button. LiveKit is a headless SFU: we build every control, and recording /
transcript / summary become ours.

**Zoom stays.** A customer with a paid Zoom integrates theirs; everyone else gets
LiveKit. `meeting_provider_config` is already per-account with a global-default
fallback, so this is the model it was built for.

## What already exists (TuraClickMeet)

TuraClickMeet is a **product under active development** — reuse by copying, never
by importing across projects, and never by sharing its running services.

| Piece | Where | Reusable |
|---|---|---|
| Token minting, role grants, room lifecycle, `remove_participant`, `set_participant_can_publish`, `mute_participant_track` | `backend/app/services/livekit_service.py` | Yes — port |
| Egress start/stop, recording lifecycle, local file storage, reconcile | `backend/app/services/recording_service.py` | Yes — port |
| Room UI: `RoomExperience.tsx`, `Controls.tsx`, `VideoStage.tsx`, `SidePanel.tsx`, `useLiveKit.ts` (~2,100 lines) | `frontend/src/room/` | Yes — port |
| Side panel tabs (Chat / Q&A / Polls / People / Whiteboard), start-stop recording, mute-all, `chat_enabled` host toggle | same | Yes |

That side panel and those host controls are close to what TuraQuant has been
building by hand against Zoom — most of this is a port, not a new build.

### Two blockers on straight reuse

1. **Async vs sync.** TuraClickMeet is async SQLAlchemy (`AsyncSession`,
   `aiomysql`) and the LiveKit Python SDK (`livekit-api`) is async. TuraQuant's
   endpoints are sync `def` with `Session`. Either the new endpoints become
   `async def`, or the LiveKit calls run through a bridge. Don't paste the
   services in unchanged — they will not work.
2. **TS vs JS.** That room UI is TypeScript + Vite (`.tsx`). TuraQuant is CRA
   JavaScript. Port to `.js` or add TS support to the CRA build.

## Isolation — the hard rule

> Running TuraQuant must have **no effect** on TuraClickMeet.

TuraQuant gets its **own** LiveKit + egress + redis, on its own ports. Do not
point TuraQuant at `turaclickmeet-livekit-1`.

| Service | TuraClickMeet (existing — do not touch) | TuraQuant (new) |
|---|---|---|
| LiveKit HTTP/WS | 7880 | **7890** |
| LiveKit TCP fallback | 7881 | **7891** |
| LiveKit UDP media | 7882/udp | **7892/udp** |
| Redis | 6379 | **6380** |
| Egress output | `TuraClickMeet/backend/media/recordings` | `TuraQuant/backend/uploads/meetings/livekit` |

Compose project names differ (`turaclickmeet-*` vs `turaquant-*`), so containers,
networks and volumes never collide. Either stack can be stopped without touching
the other.

### Can we just use the running one locally?

Technically yes — LiveKit is namespaced by room name, and with a distinct prefix
(below) the two products' rooms cannot collide. **But don't**, for one concrete
reason: egress writes to `/out`, which TuraClickMeet maps to *its*
`backend/media/recordings` and serves at `/media`. TuraQuant recordings would land
in TuraClickMeet's media folder. That is exactly the interference we're avoiding,
and a second stack is ~30 lines.

### Room naming

TuraClickMeet uses `event-{slug}` and `event-{event_id}-breakout-{index}`
(`backend/app/models/event.py`). TuraQuant must use a prefix that cannot collide:

```
tq-meeting-{board_meeting_id}
```

Keep this even with separate servers — it makes logs from either product
unambiguous.

## Local setup

### 1. `docker-compose.yml` (new, in TuraQuant root)

```yaml
# LiveKit stack for TuraQuant. Ports are deliberately offset from
# TuraClickMeet's (7880/7881/7882/6379) so both can run at once.
services:
  livekit:
    # Must stay in step with `livekit-client` in the frontend. A client NEWER
    # than the server negotiates a protocol the server doesn't implement: ICE
    # completes, the server reports "participant active", but the browser's peer
    # connection never reaches `connected` and full-reconnects every 15s. The
    # tell in the logs is: unsupported datachannel added ... label "_data_track".
    image: livekit/livekit-server:v1.10
    # LiveKit advertises ONE IP in its ICE candidates, and two different peers
    # must reach it: the browser on the host, and Egress's headless Chrome
    # inside Docker. 127.0.0.1 satisfies only the browser — inside Egress it
    # points at Egress itself and recording aborts with "Start signal not
    # received". Use the host's LAN IP. Re-run when you change networks.
    command: --config /etc/livekit.yaml --node-ip ${LIVEKIT_NODE_IP:-127.0.0.1}
    restart: unless-stopped
    ports:
      - "7890:7880"
      - "7891:7881"
      - "7892:7882/udp"
    volumes:
      - ./infra/livekit.yaml:/etc/livekit.yaml:ro

  egress:
    image: livekit/egress:v1.9
    restart: unless-stopped
    depends_on: [livekit, redis]
    environment:
      EGRESS_CONFIG_FILE: /etc/egress.yaml
    volumes:
      - ./infra/egress.yaml:/etc/egress.yaml:ro
      - ./backend/uploads/meetings/livekit:/out
    # Headless Chrome needs both: without SYS_ADMIN its sandbox won't start,
    # without the bigger /dev/shm it crashes mid-recording.
    cap_add: [SYS_ADMIN]
    shm_size: 1gb

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6380:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

### 2. `infra/livekit.yaml`

```yaml
port: 7880
rtc:
  tcp_port: 7881
  # Single-port UDP mux. Do NOT also set port_range_start/end — the range wins,
  # LiveKit then advertises candidates on ports like 50069 that compose never
  # published, ICE looks negotiated, no media flows, and the client reconnects
  # forever. If you need a range, publish the same range in compose.
  udp_port: 7882
  use_external_ip: false        # true in production
keys:
  # Generate fresh — do NOT copy TuraClickMeet's dev keys.
  #   docker run --rm livekit/livekit-server generate-keys
  <API_KEY>: <API_SECRET>
redis:
  address: redis:6379           # in-network name; host port is 6380
```

### 3. `infra/egress.yaml`

```yaml
api_key: <API_KEY>              # same pair as livekit.yaml
api_secret: <API_SECRET>
ws_url: ws://livekit:7880
insecure: true                  # dev speaks ws:// not wss://
redis:
  address: redis:6379
log_level: info
cpu_cost:
  room_composite_cpu_cost: 2    # each concurrent recording = one headless Chrome
```

### 4. Backend `.env`

```
LIVEKIT_URL=ws://localhost:7890
LIVEKIT_API_KEY=<API_KEY>
LIVEKIT_API_SECRET=<API_SECRET>
LIVEKIT_NODE_IP=<your LAN IP>       # not 127.0.0.1 — see the compose comment
```

### 5. Bring it up

```bash
cd /Users/atulteotia/Desktop/Python_Projects/TuraQuant
docker compose up -d
docker compose ps                  # livekit, egress, redis all Up
curl -s http://localhost:7890      # LiveKit answers on its own port
docker ps --filter name=turaclickmeet   # unchanged, still Up
```

## Backend integration

1. `pip install livekit-api==0.8.2` (the version TuraClickMeet runs) — add to
   `backend/requirements.txt`.
2. **Widen the provider enum** — `meeting_provider_config.provider` is currently
   `enum('teams','zoom')`. Adding `livekit` is a schema change:
   ```sql
   ALTER TABLE meeting_provider_config
     MODIFY COLUMN provider ENUM('teams','zoom','livekit') NOT NULL;
   ```
   ⚠️ This **must** get an entry in `deployment/transfer/04_DATABASE_QUERIES.sql`
   when implemented — the live DB is migrated from that file alone.
3. Port `livekit_service.py` to sync, keeping `account_id` (it already matches
   TuraQuant's per-account provider model).
4. `BoardMeeting` gains a room name — derive it (`tq-meeting-{id}`) rather than
   storing a column, so there's no migration and no drift.
5. Recording: egress writes MP4 into `uploads/meetings/livekit`, then insert a
   `MeetingRecording` row with `source=...` — the table already exists and the
   organizer-only rule in `meeting_transcripts.py` applies unchanged.
6. Transcript + summary: run the egress audio through Whisper/Deepgram, then
   summarise with the existing `AIConfiguration`. This is the payoff — neither
   depends on any Zoom plan.

## Frontend integration

- `npm i livekit-client@2.20.1` — **must match the server major/minor**; see the
  version trap above.
- Port `frontend/src/room/*` from TuraClickMeet, TSX → JS.
- Reuse TuraQuant's existing left panel (surveys / polls / chat already built) and
  drop LiveKit's video grid into the right-hand area where `MeetingVideo` sits.
- Host controls map directly: mute-all, remove participant, start/stop recording —
  all already have service functions in TuraClickMeet.

## Production install (live server)

Two independent LiveKit instances, one per product — as agreed.

- Separate ports per the table above; publish **UDP**, not just TCP. A firewall
  that drops UDP is the most common cause of "connects but no video".
- `use_external_ip: true`, and `--node-ip` set to the server's public IP.
- **wss:// required** — browsers refuse `ws://` from an HTTPS page. Terminate TLS
  in nginx and drop `insecure: true` from `egress.yaml`.
- Generate **fresh keys per instance**. Never reuse dev keys, and never share one
  key pair between the two products.
- Redis per instance (or one Redis with a different `db` index) — egress finds
  jobs through Redis, so a shared one would let the two products' egress workers
  pick up each other's jobs. This is the single most dangerous thing to share.
- Recording disk: each product writes to its own path. Plan capacity — composite
  MP4 is roughly 1–2 GB/hour per room.

## Open items

- [ ] Confirm scale target: ~5000 **concurrent in one room** (needs livestream /
      HLS architecture) vs ~5000 **accounts on the platform** (trivial). Advisory boards run
      10–30 people, so the second is assumed until told otherwise.
- [ ] Decide sync-bridge vs `async def` endpoints before porting the services.
- [ ] TURN server for participants behind restrictive corporate firewalls — KOLs
      often are.
- [ ] Whether LiveKit becomes the default for new accounts, or opt-in.
