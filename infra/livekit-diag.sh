#!/usr/bin/env bash
# LiveKit diagnostics — run ON THE SERVER, paste the output.
#
#   cd <folder with docker-compose.yml>
#   bash infra/livekit-diag.sh
#
# Read-only: it inspects and prints, it never edits or restarts anything.
# Secrets are fingerprinted (first 6 chars + length), never printed in full, so
# the output is safe to paste into a chat while still letting us tell whether the
# server's key matches the one in the repo.
#
# The question this exists to answer: LiveKit advertises exactly ONE address in
# its ICE candidates, and browsers send media there directly. If that address is
# not the server's public IP, signalling works perfectly and media never
# connects — which looks like a firewall problem and is not one.

set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1

hr() { printf '\n──────── %s ────────\n' "$1"; }
fp() {  # fingerprint a secret: first 6 chars + length
  local v="${1:-}"
  [ -z "$v" ] && { echo "(empty)"; return; }
  echo "${v:0:6}…  (len ${#v})"
}

echo "LiveKit diagnostics — $(date -u '+%Y-%m-%d %H:%M:%SZ')"
echo "project dir: $(pwd)"

hr "1. Addresses"
# -4 is required: without it curl may answer over IPv6 and report a v6 address,
# which would compare false against LiveKit's v4 nodeIP and fake a MISMATCH.
PUB=$(curl -4 -s -m 10 ifconfig.me || curl -4 -s -m 10 ipinfo.io/ip)
echo "public IP (as the internet sees this box): ${PUB:-UNKNOWN}"
echo "interface addresses:"
ip -4 -o addr show 2>/dev/null | awk '{print "  " $2 "  " $4}' || ifconfig | grep 'inet '
echo
echo "NOTE: on most cloud VMs the public IP is NOT on any interface (1:1 NAT)."
echo "      That is normal and is exactly why --node-ip / use_external_ip exist."

hr "2. What LiveKit is actually advertising  ← THE decisive line"
CID=$(docker compose ps -q livekit 2>/dev/null)
if [ -z "$CID" ]; then
  CID=$(docker ps -q --filter "name=livekit" | head -1)
fi
if [ -z "$CID" ]; then
  echo "!! no livekit container found — is the stack up?"
else
  echo "container: $(docker inspect "$CID" --format '{{.Name}}  ({{.Config.Image}})')"
  echo "command  : $(docker inspect "$CID" --format '{{join .Config.Cmd " "}}')"
  echo "started  : $(docker inspect "$CID" --format '{{.State.StartedAt}}')"
  echo
  NODEIP=$(docker logs "$CID" 2>&1 | grep "starting LiveKit server" | tail -1 \
           | grep -oE '"nodeIP": *"[^"]*"' | cut -d'"' -f4)
  docker logs "$CID" 2>&1 | grep "starting LiveKit server" | tail -1
  echo
  echo ">>> advertised nodeIP : ${NODEIP:-UNKNOWN}"
  echo ">>> public IP         : ${PUB:-UNKNOWN}"
  if [ -n "${NODEIP:-}" ] && [ -n "${PUB:-}" ]; then
    if [ "$NODEIP" = "$PUB" ]; then
      echo ">>> VERDICT: MATCH — the media address is correct."
    else
      echo ">>> VERDICT: ***MISMATCH — THIS IS THE BUG.***"
      echo ">>>          Browsers are being told to send media to $NODEIP,"
      echo ">>>          which is not this server. Signalling will still work."
    fi
  fi
fi

hr "3. Config: node IP + external IP"
echo "-- root .env --"
grep -E '^[^#]*LIVEKIT' .env 2>/dev/null || echo "  (no LIVEKIT lines / no .env)"
echo "-- infra/livekit.yaml --"
grep -nE 'use_external_ip|tcp_port|udp_port|^port:' infra/livekit.yaml 2>/dev/null
echo "-- docker-compose.yml (livekit service) --"
sed -n '/^  livekit:/,/^  [a-z]/p' docker-compose.yml 2>/dev/null \
  | grep -E 'command:|image:|- "|node-ip' | sed 's/^/  /'

hr "4. Published ports"
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -Ei 'livekit|egress|redis'
echo
echo "-- host listeners on 789x --"
(ss -lntup 2>/dev/null || netstat -lntup 2>/dev/null) | grep -E '789[0-9]' || echo "  (none seen)"

hr "5. Firewall (ufw)"
ufw status verbose 2>/dev/null | head -25 || echo "  ufw not available / not root"
echo
echo "REMINDER: the cloud provider's security group is a SEPARATE filter and is"
echo "          not visible here. 7892/udp + 7891/tcp must be open there too,"
echo "          and open to 0.0.0.0/0 — media does NOT come via Cloudflare."

hr "6. Keys (fingerprints only)"
YKEY=$(grep -A5 '^keys:' infra/livekit.yaml 2>/dev/null | grep -oE 'API[A-Za-z0-9]+' | head -1)
YSEC=$(grep -A5 '^keys:' infra/livekit.yaml 2>/dev/null | sed -n 's/.*API[A-Za-z0-9]*: *//p' | head -1)
echo "livekit.yaml  key: ${YKEY:-(none)}   secret: $(fp "$YSEC")"
EKEY=$(grep -E '^api_key:'    infra/egress.yaml 2>/dev/null | awk '{print $2}')
ESEC=$(grep -E '^api_secret:' infra/egress.yaml 2>/dev/null | awk '{print $2}')
echo "egress.yaml   key: ${EKEY:-(none)}   secret: $(fp "$ESEC")"
for BE in /var/www/turaquant/backend/.env backend/.env; do
  [ -f "$BE" ] || continue
  echo "-- $BE --"
  echo "  LIVEKIT_URL        : $(grep -E '^LIVEKIT_URL='  "$BE" | cut -d= -f2-)"
  echo "  LIVEKIT_API_KEY    : $(grep -E '^LIVEKIT_API_KEY=' "$BE" | cut -d= -f2-)"
  echo "  LIVEKIT_API_SECRET : $(fp "$(grep -E '^LIVEKIT_API_SECRET=' "$BE" | cut -d= -f2-)")"
  echo "  LIVEKIT_ROOM_PREFIX: '$(grep -E '^LIVEKIT_ROOM_PREFIX=' "$BE" | cut -d= -f2-)'"
done
echo
echo "All three key/secret pairs above MUST be identical or tokens are rejected."

hr "7. nginx vhost for the livekit subdomain"
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  grep -lE 'livekit\.' "$f" 2>/dev/null && grep -nE 'server_name|proxy_pass|Upgrade|proxy_read_timeout' "$f" | sed 's/^/    /'
done
echo "(nothing printed above = no dedicated livekit vhost found in the usual paths)"

hr "8. Recent ICE failures"
if [ -n "${CID:-}" ]; then
  docker logs "$CID" 2>&1 | grep -iE 'candidate pair|ICE|failed|removing participant without connection' \
    | tail -12 | cut -c1-400
  echo
  echo "Look for state:\"failed\" with requestsSent>0 and responsesReceived:0 —"
  echo "that is 'nobody is listening at the advertised address', not a blocked port."
fi

hr "done"
echo "Paste everything above. Section 2's VERDICT line is the one that matters most."
