# LiveKit on the production server — install, expose, connect

How the deployed TuraQuant app reaches LiveKit once the SFU is installed on the
cloud server. Written 2026-08-07.

`livekit.md` (repo root) covers *why* LiveKit exists here and how the local dev
stack is built. **This file is only about the live server**: what changes from
dev, what nginx and the firewall need, and how the three connection paths are
wired.

---

## 1. Answer first: does LiveKit live on the same server?

**Yes — same box, as the docker-compose stack already in the repo.** MySQL,
FastAPI, nginx and LiveKit all run on `turasphere.com`. Nothing about the
app assumes a separate machine.

That holds because of what an SFU actually costs. LiveKit does not transcode; it
relays. CPU per room is small — the real budget is **uplink bandwidth**, roughly
`(participants − 1) × publisher bitrate` out of the server per subscriber. A
20-person advisory board at ~1 Mbps video each is a few hundred Mbit/s at the
worst case, and LiveKit's simulcast drops that a lot in practice. Advisory boards
run 10–30 people, so one server is right.

Move LiveKit to its own machine when either of these becomes true:

- **Recording volume grows.** Each concurrent egress job is a headless Chrome
  compositing 1080p — that is the CPU-hungry part, not the SFU, and it will
  starve the API process before LiveKit does.
- **Rooms get large** (hundreds of viewers), which is a different architecture
  anyway — livestream / HLS, listed under open items in `livekit.md`.

Nothing in the app changes if you move it later: the address is one env var
(§6), so a move is a DNS change plus a restart.

---

## 2. How the app connects — three paths, not one

The frontend has **no LiveKit URL of its own**. `POST /api/meetings/{id}/livekit/token`
returns `{token, url, room, identity, is_organizer, can_record}`
(`backend/app/api/endpoints/meeting_livekit.py`), and `LiveKitRoom.js` connects
to whatever `url` the backend hands it. So one backend env var moves every
client — no rebuild, no redeploy of the static bundle.

```
                            ┌──────────────────────────────────────────┐
  Browser (participant)     │        turasphere.com             │
        │                   │                                          │
        │  1. POST /api/meetings/7/livekit/token                       │
        ├──────────────────►│  nginx :443 ──► FastAPI :8000            │
        │  {token, url}     │                    │                     │
        │◄──────────────────┤                    │ 3. REST (twirp):    │
        │                   │                    │    mint token, mute,│
        │  2. wss:// signalling                  │    remove, egress   │
        ├──────────────────►│  nginx :443 ──► LiveKit :7890 ◄──────────┤
        │                   │  (livekit. subdomain)   │                │
        │  4. WebRTC media  │                         │ 5. ws://livekit:7880
        ├══════════════════►│  UDP 7892 / TCP 7891 ──►│  (docker network)
        │   (direct, no nginx)                        │                │
                            │                    Egress ──► uploads/meetings/livekit
                            └──────────────────────────────────────────┘
```

| # | Path | Who → who | Address | Through nginx? |
|---|---|---|---|---|
| 1 | Token | Browser → FastAPI | `https://turasphere.com/api/...` | yes |
| 2 | Signalling | Browser → LiveKit | `wss://livekit.turasphere.com` | yes (TLS terminates here) |
| 3 | Server API | FastAPI → LiveKit | same URL, rewritten `wss://`→`https://` | yes |
| 4 | Media | Browser ⇄ LiveKit | server public IP, **UDP 7892**, TCP 7891 fallback | **no** — direct |
| 5 | Recording | Egress → LiveKit | `ws://livekit:7880` (internal docker network) | no — never leaves the box |

Two consequences worth internalising:

- **Path 4 does not go through nginx.** A correct nginx config with a closed UDP
  port gives you the classic failure: the room joins, the participant list is
  right, and no video ever appears. Nginx cannot help you here — WebRTC media is
  not HTTP.
- **Path 3 hairpins.** `LIVEKIT_URL` is used both by the browser and by the
  backend — `livekit_service.LiveKitCredentials.http_url` just swaps the scheme.
  So the backend's REST calls leave the box and come back through nginx. It
  works and is what the code expects; it is only mildly wasteful. Pointing the
  backend at `http://127.0.0.1:7890` directly would need a second setting and a
  code change — do not "optimise" this without one, because the same value is
  what gets handed to browsers.

### Local development uses this same server (since 2026-08-10)

There is no local LiveKit any more. `backend/.env` points at
`wss://livekit.turasphere.com` exactly like production, so the infra files in
this repo hold production values and need no per-environment switching.

The local stack was removed because it advertised the laptop's LAN IP in its ICE
candidates: every network change silently broke media — room joins, participant list
correct, no video — and needed `set-node-ip.sh` plus a compose restart. A server's
address does not move.

**The one thing that must stay different is `LIVEKIT_ROOM_PREFIX`** (`dev-` locally,
empty in production). Meeting ids collide between the two databases, so with a shared
server an unprefixed local meeting 14 joins `tq-meeting-14` — the live board's room,
with real KOLs in it. An API key cannot stop that: **any valid key may join any
room**, so the room name is the only isolation boundary. See
`livekit_service.room_name()`.

Trade-offs accepted: local meeting work now needs internet; recordings started
locally are composited by the *server's* egress and land on the server, not on the
laptop; and the laptop holds the production API secret.

### Per-account override

A customer can point their meetings at *their own* LiveKit without any code
change: Account → Meeting Platforms → LiveKit stores `tenant_id` = their
`wss://` URL, `client_id` = API key, `client_secret` = API secret (encrypted).
`livekit_service.get_credentials()` prefers that row and falls back to the
platform `LIVEKIT_*` settings — the same resolution order as Zoom and Teams.
Everything below configures the **platform default**.

---

## 3. Prerequisites on the server

```bash
# Docker (the app itself is not dockerised — only the LiveKit stack is)
curl -fsSL https://get.docker.com | sh
docker compose version          # v2 plugin must be present

# DNS: a second A record pointing at the SAME server IP
#   livekit.turasphere.com   A   <SERVER_PUBLIC_IP>
dig +short livekit.turasphere.com
```

A subdomain is used rather than a path on the main host because LiveKit expects
to own its root path (`/`, `/rtc`, `/twirp/...`); mounting it under a prefix
means rewriting paths and is not worth the fragility.

---

## 4. Generate production keys

The pair currently in `infra/livekit.yaml` and `infra/egress.yaml`
(`API9e974731b257` / `QObiz…`) is a **dev key committed to the repo**. It must
not reach the server.

```bash
docker run --rm livekit/livekit-server generate-keys
# APIxxxxxxxxxxxx: <secret>
```

The same pair goes in three places, and all three must match:
`infra/livekit.yaml` (`keys:`), `infra/egress.yaml` (`api_key`/`api_secret`),
and the backend `.env` (`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`).

---

## 5. Config changes from dev

### 5.1 `infra/livekit.yaml`

```yaml
port: 7880

rtc:
  tcp_port: 7891
  udp_port: 7892
  # ── ALREADY COMMITTED AS `true` since 2026-08-10 ──
  # No longer an edit you make on the server. Local dev stopped running its own
  # LiveKit (it points at this one via LIVEKIT_URL), so these files are
  # production-only and carry production values directly.
  #
  # LiveKit must advertise the PUBLIC address in its ICE candidates, or browsers
  # are told to send media to an address that only exists inside the VPC.
  use_external_ip: true

keys:
  APIxxxxxxxxxxxx: <production secret>   # from §4 — never the dev pair

room:
  enable_remote_unmute: true             # unchanged, see the comment in the file

redis:
  address: redis:6379
```

Leave `tcp_port` / `udp_port` exactly as they are, and keep the compose mapping
1:1 (`7891:7891`, `7892:7892/udp`). LiveKit writes those numbers straight into
the ICE candidates it advertises — the long warning in `infra/livekit.yaml` is
load-bearing and cost a full debugging cycle once already.

### 5.2 `docker-compose.yml`

**All three edits are committed as of 2026-08-10** — nothing to change by hand any
more. What is in the file, and why:

```yaml
services:
  livekit:
    # --node-ip is passed ONLY when LIVEKIT_NODE_IP is non-empty. Leave it empty:
    # `use_external_ip: true` auto-detects the public address, which needs no
    # maintenance. The old `:-127.0.0.1` default was a trap — an unset variable
    # produced a server advertising loopback, i.e. media that never connects
    # while signalling works perfectly.
    command: --config /etc/livekit.yaml ${LIVEKIT_NODE_IP:+--node-ip ${LIVEKIT_NODE_IP}}
    ports:
      # Signalling on localhost only. nginx is the sole way in, so a plaintext
      # ws:// on :7890 can never be reached from outside and TLS cannot be
      # bypassed.
      - "127.0.0.1:7890:7880"
      # Media stays published on ALL interfaces — these are the ports browsers
      # send WebRTC to directly, and they must be 1:1 (see 5.1).
      - "7891:7891"
      - "7892:7892/udp"

  egress:
    # `host.docker.internal` DOES NOT EXIST on Linux. Without this the egress
    # container cannot fetch our recording layout and silently falls back to
    # LiveKit's stock template, which omits camera-off participants entirely.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      # EGRESS_OUT_DIR in the root .env = /var/www/turaquant/uploads/meetings/livekit.
      # It must be outside backend/: deploys replace that tree, the bind mount
      # stays attached to the deleted folder, and every recording fails with
      # "open /out/…mp4: no such file or directory" until egress is restarted.
      # Set EGRESS_HOST_DIR in backend/.env to the same folder.
      - ${EGRESS_OUT_DIR:-./backend/uploads/meetings/livekit}:/out

  redis:
    # Localhost only. Nothing outside the box should reach an unauthenticated
    # Redis; livekit and egress use the compose network (`redis:6379`) anyway.
    ports:
      - "127.0.0.1:6380:6379"
```

Set `LIVEKIT_NODE_IP` in the root `.env` **only** to pin one address on a box with
several public IPs — and then it must be the origin public IP, never a private
(10.x / 172.x / 192.168.x) address and never a Cloudflare IP.

> **Do not run `infra/livekit-up.sh` or `infra/set-node-ip.sh` on the server.**
> The Linux branch is `hostname -I | awk '{print $1}'` — on a cloud VM that returns
> the *private* address and silently overwrites `LIVEKIT_NODE_IP`. The symptom is
> identical to a firewall problem: signalling connects, media never does. Those
> scripts existed for the old local stack, which no longer runs. Use plain
> `docker compose up -d` here.

### 5.3 `infra/egress.yaml`

```yaml
api_key: APIxxxxxxxxxxxx          # production pair
api_secret: <production secret>
ws_url: ws://livekit:7880         # UNCHANGED — internal docker network
insecure: true                    # UNCHANGED — see below
redis:
  address: redis:6379
log_level: info
cpu_cost:
  room_composite_cpu_cost: 2
```

**Keep `insecure: true`.** `livekit.md` says to drop it in production, but that
assumed egress reaching LiveKit through the public TLS endpoint. It does not —
it connects over the compose network as `ws://livekit:7880`, which never leaves
the host, and `insecure: false` would make it refuse that plaintext connection.
Browsers are unaffected: they use the `wss://` path in §5.4. Sending egress out
through nginx would only add a TLS handshake and a hairpin for traffic that is
already inside the box.

### 5.4 nginx — new server block

Save as `/etc/nginx/sites-available/livekit.conf` and symlink into
`sites-enabled/`. (Kept separate from `deployment/nginx/turaquant.conf` so
`deploy.sh`, which overwrites that file, cannot clobber it.)

```nginx
server {
    listen 80;
    server_name livekit.turasphere.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name livekit.turasphere.com;

    ssl_certificate     /etc/letsencrypt/live/livekit.turasphere.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.turasphere.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Everything LiveKit serves lives at the root: the WebSocket upgrade on
    # /rtc, the twirp REST API the backend calls, and the health check on /.
    location / {
        proxy_pass http://127.0.0.1:7890;

        # ── WebSocket upgrade. Without these three the browser gets a 400 and
        #    the room sits on "Connecting…" forever.
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A signalling socket is open for the whole meeting and is idle whenever
        # nobody joins, leaves or mutes. nginx's 60s default would cut it mid-
        # call and the client would reconnect every minute.
        proxy_read_timeout 7d;
        proxy_send_timeout 7d;

        # Signalling is latency-sensitive and small. Buffering adds delay to
        # every join and mute for no benefit.
        proxy_buffering off;
    }
}
```

```bash
sudo certbot --nginx -d livekit.turasphere.com --agree-tos \
     --email admin@turacoz.com --non-interactive
sudo nginx -t && sudo systemctl reload nginx
```

### 5.5 Firewall

```bash
sudo ufw allow 443/tcp        # signalling + the app itself
sudo ufw allow 7892/udp       # primary WebRTC media  ← the one people forget
sudo ufw allow 7891/tcp       # TCP fallback for UDP-blocked networks
sudo ufw status
```

**Also open 7892/udp and 7891/tcp in the cloud provider's security group.** ufw
and the provider firewall are two independent filters and both drop by default;
UDP in particular is often not open even when TCP is.

⚠️ **Cloudflare is in front of both hostnames** (`livekit.turasphere.com`
resolves to `104.26.x.x`). Cloudflare proxies HTTP on 80/443 only — **WebRTC media
cannot pass through it**. Browsers send media straight to the origin IP that LiveKit
puts in its ICE candidates, bypassing Cloudflare entirely. Two consequences:

- 7891/7892 must accept traffic **from anywhere**, not just Cloudflare's IP ranges.
  Locking the firewall to those ranges leaves signalling working and media dead —
  the same symptom as every other media misconfiguration in §9.
- The origin IP is therefore visible to participants. That is inherent to WebRTC
  without a TURN relay, not something this setup chose.

Signalling itself is fine through the proxy: Cloudflare supports WebSocket upgrades,
verified with a real join token returning `101 Switching Protocols`. If you would
rather not depend on that, set the `livekit.` record to DNS-only (grey cloud) — the
proxy buys nothing here since media skips it anyway.

Port 7890 stays closed — it is bound to `127.0.0.1` in §5.2 and only nginx
reaches it. Redis 6380 likewise should not be exposed; drop the `ports:` block
from the redis service if you want it unreachable even from localhost, since
only egress and LiveKit talk to it and they do so over the compose network.

---

## 6. Backend `.env` on the server

Append to `/var/www/turaquant/backend/.env` (and to `backend/.env.production`
in the repo so the next `deploy.sh` carries it):

```bash
# ── LiveKit (platform default) ────────────────────────────────────────────────
# This value is handed to BROWSERS in the token response, so it must be the
# public wss:// URL — not localhost, not the container name. The backend derives
# its own REST base from it by swapping the scheme (livekit_service.http_url).
LIVEKIT_URL=wss://livekit.turasphere.com
LIVEKIT_API_KEY=APIxxxxxxxxxxxx
LIVEKIT_API_SECRET=<production secret>

# Where egress's headless Chrome fetches our recording layout from. Resolved
# INSIDE the container, so `localhost` would mean egress itself. 172.17.0.1 is
# the docker bridge gateway = the host; requires the extra_hosts entry in §5.2
# if you prefer the hostname form instead.
EGRESS_TEMPLATE_BASE_URL=http://172.17.0.1:8000/egress-template/egress_template.html
```

`ws://` here instead of `wss://` is the single most likely mistake: an HTTPS page
will refuse the connection outright, and the browser console shows a mixed-content
error rather than anything LiveKit-shaped.

⚠️ **`turaquant-backend.service` currently starts uvicorn with `--host 127.0.0.1`**,
which the egress container cannot reach — `172.17.0.1:8000` will refuse the
connection and recordings will quietly use the stock layout. Change the unit to
`--host 0.0.0.0` (and `systemctl daemon-reload && systemctl restart
turaquant-backend`). Port 8000 stays private: nginx proxies it locally and ufw
never opens it, so binding all interfaces exposes it to docker containers only.

---

## 7. Bring it up

```bash
cd /var/www/turaquant           # wherever docker-compose.yml lives on the server
docker compose up -d
docker compose ps               # livekit, egress, redis all Up

sudo systemctl restart turaquant-backend
```

## 8. Verify, in order

Each step isolates one of the paths in §2 — do them in sequence, because a later
one failing is meaningless if an earlier one did.

```bash
# 1. LiveKit is alive behind nginx (path 2/3)
curl -s https://livekit.turasphere.com          # -> OK

# 2. The WebSocket upgrade survives nginx — expect 101 Switching Protocols
curl -i -N -o- -s \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://livekit.turasphere.com/rtc | head -1

# 3. LiveKit advertises the PUBLIC ip, not a private one (path 4)
docker logs turaquant-livekit-1 2>&1 | grep "starting LiveKit server" | tail -1

# 4. UDP is actually open from outside — run this from your laptop, NOT the server
nc -zvu <SERVER_PUBLIC_IP> 7892
```

5. **The app agrees it is configured.** Log in and use Account → Meeting
   Platforms → LiveKit → Test (`POST /api/account/meeting-providers/livekit/test`),
   which resolves credentials through the same `get_credentials()` chain the real
   join path uses. A green result means the backend can mint tokens and reach
   LiveKit's REST API — path 3 in §2.

Then a real check: schedule a meeting with provider `livekit`, join from two
different networks (one on mobile data), and confirm two-way video. Recording is
a separate surface — start one and confirm an MP4 lands in
`backend/uploads/meetings/livekit`.

---

## 9. Troubleshooting — symptom to cause

| Symptom | Almost always |
|---|---|
| "Connecting…" forever, no 101 in nginx access log | Missing `Upgrade`/`Connection` headers in the nginx block (§5.4) |
| Mixed-content / connection refused in browser console | `LIVEKIT_URL` still `ws://` — must be `wss://` (§6) |
| Joins fine, participant list correct, **no video** | UDP 7892 blocked — ufw *or* the cloud security group (§5.5) |
| Same, but only for some participants (typically external clients / KOLs: "could not establish pc connection") | Their corporate firewall allows only 443 out. Fixed by TURN on 443 (§12) — check it with `?relay=1` (§12.8) |
| Sites down / wrong certificate after a CloudPanel change | A vhost is back on `listen 443 ssl` — CloudPanel regenerated it or a new site was added. Move it to `127.0.0.1:10443` (§12.6, §12.9) |
| `?relay=1` fails, TURN log shows allocations | Relay ports 30000-30200/udp closed in the cloud security group (§12.4) |
| Media fails after a redeploy that "changed nothing" | `livekit-up.sh` / `set-node-ip.sh` overwrote `LIVEKIT_NODE_IP` with the private IP (§5.2) |
| Client reconnects every 15s, logs mention `unsupported datachannel … "_data_track"` | `livekit-client` in the frontend is newer than `livekit-server`; they must stay in step (see `docker-compose.yml`) |
| Recording aborts, "Start signal not received" | Egress cannot reach the node IP, or `EGRESS_TEMPLATE_BASE_URL` unreachable from inside docker (§6) |
| Recording works but camera-off participants vanish | Egress fell back to LiveKit's stock template — the template URL is wrong (§6) |
| Recording starts then nothing happens | Egress and LiveKit are on different Redis instances; both must use the compose-internal `redis:6379` |
| `LiveKit isn't configured` (HTTP 400) | One of the three `LIVEKIT_*` vars empty — the check is in `livekit_service.get_credentials()` |

---

## 10. Capacity notes

- **Bandwidth** is the binding constraint, not CPU. Budget server uplink for
  `(n−1) × n × bitrate` in the worst case of everyone publishing; simulcast makes
  the real number much lower.
- **Recording disk**: composite MP4 is roughly 1–2 GB per hour per room, written
  to `backend/uploads/meetings/livekit`. Plan retention before this fills the
  root volume — it shares a disk with MySQL.
- **Concurrent recordings**: each is a headless Chrome, memory-hungry.
  `room_composite_cpu_cost: 2` in `egress.yaml` is what stops egress accepting
  more jobs than the box can composite; raise it (making each job *more*
  expensive) if recordings degrade under load.

## 11. Still open

- ~~TURN server for participants behind restrictive corporate firewalls~~ —
  done, TURN on 443 (§12).
- Whether egress moves to its own host once recording volume grows (§1).
- Backup/retention policy for recordings.

---

## 12. TURN relay on 443 — for clients and KOLs on corporate networks

Added 2026-10-28. **Symptom it fixes:** internal users join fine; a client or KOL
from another organisation gets "could not establish (pc) connection". Their
network lets 443 out, so signalling works, but drops UDP 7892 / TCP 7891, so
media never connects. TURN gives them a relay on 443, which looks like ordinary
HTTPS to their firewall.

How 443 is shared (nginx already owns it for every site on the box):

```
client :443 ─► nginx stream (reads SNI, does not decrypt)
                 ├─ turn.turasphere.com ─► nginx TLS (CloudPanel cert) ─► 127.0.0.1:5349 LiveKit TURN
                 └─ anything else ──────────────► 127.0.0.1:10443 the normal HTTPS vhosts
```

Repo files: `infra/livekit.yaml` (`turn:`), `docker-compose.yml` (ports; git-ignored,
edit by hand on the server), `deployment/nginx/stream-443.conf`,
`deployment/nginx/turaquant.cloudpanel.conf` (listen lines),
`infra/turn-preflight.sh`. LiveKit hands the TURN URLs and per-participant
credentials to browsers itself — no backend change.

Run everything below **on the server**, in order, preferably outside meeting
hours. Only §12.6 touches the websites, and with a reload it is seamless.

```bash
# The folder holding docker-compose.yml, read off the running LiveKit container
APP=$(docker inspect "$(docker ps -qf name=livekit | head -1)" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
echo "$APP"; ls "$APP/docker-compose.yml"
cd $APP
```

### 12.0 Backups

```bash
sudo tar czf /root/nginx-backup-$(date +%F-%H%M).tgz /etc/nginx
cp docker-compose.yml docker-compose.yml.bak-turn
cp infra/livekit.yaml infra/livekit.yaml.bak-turn
```

### 12.1 DNS (Cloudflare dashboard)

```bash
curl -4 -s ifconfig.me; echo          # the origin IP
```

Add `A  turn.turaquant  <that IP>`, proxy status **DNS only (grey cloud)**.
Cloudflare cannot carry TURN; an orange cloud breaks it silently.

```bash
dig +short turn.turasphere.com   # must print the origin IP, not 104.x/172.6x
```

### 12.2 Certificate (CloudPanel)

CloudPanel → **Add Site → Create a Static HTML Site**, domain
`turn.turasphere.com`. Then that site → **SSL/TLS → Actions → New Let's
Encrypt Certificate**. Renewal is CloudPanel's normal HTTP-01 on port 80, which
this change does not touch.

```bash
ls -l /etc/nginx/ssl-certificates/ | grep turn
# expect turn.turasphere.com.crt and .key — the paths stream-443.conf uses
```

### 12.3 Copy the repo files up, run the preflight

Upload `infra/livekit.yaml`, `infra/turn-preflight.sh` and
`deployment/nginx/stream-443.conf` to the same paths under `$APP`, then:

```bash
bash infra/turn-preflight.sh
```

Carry on only if: section 1 shows `with-stream`, `stream_ssl_module` and
`stream_ssl_preread_module`; section 3 shows **no** `real_ip_header` and no
`allow`/`deny` inside a vhost; section 4 shows the ports free; section 5 says ok.
Otherwise stop and send the output. Section 2 is the list of vhost files §12.6
will change — keep it.

If section 1 lists the stream modules as `=dynamic`, load them first:

```bash
ls /usr/lib/nginx/modules/ | grep stream     # or /usr/share/nginx/modules
sudo sed -i '1i load_module modules/ngx_stream_module.so;' /etc/nginx/nginx.conf
```

### 12.4 Firewall

```bash
sudo ufw allow 3478/udp           # TURN over UDP
sudo ufw allow 30000:30200/udp    # TURN relay sockets
sudo ufw status | grep -E '443|3478|30000'
```

Open the same two in the **cloud provider's security group**, from anywhere
(0.0.0.0/0). 443/tcp is already open. Do not open 5349, 5350 or 10443 — they
are localhost-only.

### 12.5 LiveKit with TURN

`docker-compose.yml` is git-ignored — edit the server copy. Under
`services.livekit.ports`, after the `7892:7892/udp` line, add:

```yaml
      - "127.0.0.1:5349:5349"
      - "3478:3478/udp"
      - "30000-30200:30000-30200/udp"
```

```bash
docker compose config --quiet && echo compose ok
docker compose up -d --force-recreate livekit
sleep 5
docker compose logs livekit 2>&1 | grep -iE 'turn|error' | tail -5    # expect TURN started, no errors
ss -ltn | grep 127.0.0.1:5349                                          # LiveKit TURN listening
```

Recreating LiveKit drops anyone currently in a LiveKit meeting for a few
seconds; the client reconnects on its own.

### 12.6 nginx: hand 443 to the stream router

All vhosts move in one reload, so the sites never go dark.

```bash
# a. Stream router, not yet included
sudo mkdir -p /etc/nginx/stream.d
sudo cp deployment/nginx/stream-443.conf /etc/nginx/stream.d/turaquant-443.conf

# b. Move every HTTPS vhost from 443 to 127.0.0.1:10443 (the files preflight §2 listed).
#    The [::]:443 ssl line is dropped — the stream router listens on [::]:443 instead.
for f in $(sudo grep -rlE 'listen\s+(\[::\]:)?443\s+ssl' /etc/nginx/sites-enabled/); do
  echo "editing $f"
  sudo sed -i --follow-symlinks -E \
    -e '/listen\s+\[::\]:443\s+ssl[^;]*;/d' \
    -e 's#listen\s+443\s+ssl([^;]*);#listen 127.0.0.1:10443 ssl proxy_protocol\1;\n    set_real_ip_from 127.0.0.1;\n    real_ip_header proxy_protocol;\n    port_in_redirect off;#' \
    "$f"
done
sudo grep -rnE 'listen\s+(\[::\]:)?443(\s|;)' /etc/nginx/ | grep -v quic   # must print NOTHING

# c. Include the router at the top level of nginx.conf (end of file = outside http{})
grep -q 'stream.d' /etc/nginx/nginx.conf || \
  echo 'include /etc/nginx/stream.d/*.conf;' | sudo tee -a /etc/nginx/nginx.conf

# d. Test, then reload (a reload keeps the 443 socket open throughout)
sudo nginx -t && sudo systemctl reload nginx
sleep 2; sudo tail -5 /var/log/nginx/error.log
sudo ss -ltnp | grep -E ':443\s|:10443|:5350'   # 443 (+[::]:443), 127.0.0.1:10443, 127.0.0.1:5350
```

If `nginx -t` fails, nothing has changed for visitors yet: run the rollback in
§12.10 and send the error.

### 12.7 Make CloudPanel agree (do not skip)

CloudPanel keeps its own copy of each vhost and rewrites the file from it — on
cert renewal, or when anyone presses Save. If its copy still says `listen 443
ssl`, the next rewrite breaks nginx. For **every site** from preflight §2:
CloudPanel → site → **Vhost**, replace

```nginx
    listen 443 ssl;
    listen [::]:443 ssl;
```

with

```nginx
    listen 127.0.0.1:10443 ssl proxy_protocol;
    set_real_ip_from 127.0.0.1;
    real_ip_header proxy_protocol;
    port_in_redirect off;
```

and Save (leave the `quic` lines alone). Then confirm nothing slipped back:

```bash
sudo grep -rnE 'listen\s+(\[::\]:)?443(\s|;)' /etc/nginx/ | grep -v quic   # must print NOTHING
sudo nginx -t
```

### 12.8 Verify

```bash
# Sites still up — through Cloudflare and straight to origin
PUB=$(curl -4 -s ifconfig.me)
curl -sI https://turasphere.com | head -1
curl -sI --resolve turasphere.com:443:$PUB https://turasphere.com | head -1
curl -s https://livekit.turasphere.com; echo        # OK

# TURN answers on 443 with its own certificate
echo | openssl s_client -connect turn.turasphere.com:443 \
  -servername turn.turasphere.com 2>/dev/null | openssl x509 -noout -subject -enddate

# Real visitor IPs (not 127.0.0.1) in the access logs
sudo tail -3 /home/*/logs/nginx/access.log 2>/dev/null || sudo tail -3 /var/log/nginx/access.log
```

In the browser, open a meeting with **`?relay=1`** on the URL (`&relay=1` if it
already has a `?`). That forces media through TURN — the path external guests
use — even from the office network. Video both ways = TURN works. To see it,
open `chrome://webrtc-internals` during the call: the selected candidate pair is
`relay`, and the connection's iceServers include
`turns:turn.turasphere.com:443?transport=tcp`.

Finally, the real test: a client or KOL on their office network joins without
any flag.

### 12.9 Living with it

- **New CloudPanel site:** it is created with `listen 443 ssl` and nginx will
  then fail to reload. Immediately edit its Vhost as in §12.7.
- **Certificate renewal** for `turn.` is automatic; the reload CloudPanel does
  picks it up in the stream block. LiveKit needs no restart.
- **`docker-compose.yml` is git-ignored:** if it is ever replaced, re-add the
  three TURN port lines (§12.5).

### 12.10 Rollback

```bash
sudo tar xzf /root/nginx-backup-*.tgz -C /      # restores /etc/nginx (pick the latest)
sudo nginx -t && sudo systemctl reload nginx
cp docker-compose.yml.bak-turn docker-compose.yml
cp infra/livekit.yaml.bak-turn infra/livekit.yaml
docker compose up -d --force-recreate livekit
```

If you had already saved vhosts in CloudPanel (§12.7), put the `listen 443 ssl`
lines back there too.
