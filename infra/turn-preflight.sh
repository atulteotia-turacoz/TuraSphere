#!/usr/bin/env bash
# TURN-on-443 preflight — run ON THE SERVER before §12 of
# deployment/LIVEKIT_PRODUCTION.md, and paste the output if anything says STOP.
#
#   cd /home/turacoz-turaquant/htdocs/turaquant.turacoz.com
#   bash infra/turn-preflight.sh
#
# Read-only: it inspects and prints, it never edits or restarts anything.

set -uo pipefail
hr() { printf '\n──────── %s ────────\n' "$1"; }
TURN_HOST=turn.turaquant.turacoz.com

hr "1. nginx has the stream + ssl_preread modules"
V=$(nginx -V 2>&1)
echo "$V" | head -1
for m in with-stream with-stream_ssl_module with-stream_ssl_preread_module with-stream_realip_module; do
  if echo "$V" | grep -q -- "--$m\b\|--$m=dynamic"; then echo "  ok    $m"; else echo "  MISSING $m"; fi
done
echo "  (dynamic modules, if any, must be load_module'd — listed here:)"
ls /etc/nginx/modules-enabled/ 2>/dev/null | sed 's/^/    /' || true
echo "existing stream{} / stream.d include in nginx.conf:"
grep -nE '^\s*(stream\s*\{|include\s+/etc/nginx/stream)' /etc/nginx/nginx.conf || echo "  (none — you will add it)"

hr "2. Every TCP listener on 443 — ALL of these must move to 127.0.0.1:10443"
# quic lines are UDP and stay; 8443 (CloudPanel admin) is not matched.
grep -rnE 'listen\s+(\[::\]:)?443(\s|;)' /etc/nginx/ 2>/dev/null | grep -v quic || echo "  (none)"

hr "3. real_ip / allow / deny already configured (would clash with proxy_protocol)"
grep -rnE '^\s*(real_ip_header|set_real_ip_from|allow|deny)\b' /etc/nginx/ 2>/dev/null \
  | grep -v '/.well-known' | head -40 || true
echo "  real_ip_header lines above => STOP and send this output."
echo "  allow/deny lines inside a vhost => STOP and send this output."

hr "4. Ports this change needs are free"
for p in 5349/tcp 5350/tcp 10443/tcp 3478/udp; do
  n=${p%/*}; proto=${p#*/}
  flag=$([ "$proto" = udp ] && echo -lunp || echo -ltnp)
  if ss $flag 2>/dev/null | grep -qE "[:.]$n\s"; then
    echo "  IN USE  $p  ->  $(ss $flag | grep -E "[:.]$n\s" | head -1)"
  else echo "  free    $p"; fi
done
used=$(ss -lunp 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$' | awk '$1>=30000 && $1<=30200' | sort -u | tr '\n' ' ')
echo "  UDP 30000-30200 in use: ${used:-none}"
echo "  (anything IN USE other than TuraQuant's own livekit => STOP and send this output)"

hr "5. DNS for $TURN_HOST — must be the origin IP, NOT Cloudflare (104.x / 172.6x)"
PUB=$(curl -4 -s -m 10 ifconfig.me || true)
DNS=$(getent ahostsv4 "$TURN_HOST" 2>/dev/null | awk 'NR==1{print $1}')
echo "  server public IP : ${PUB:-UNKNOWN}"
echo "  $TURN_HOST : ${DNS:-NOT RESOLVING}"
[ -n "$DNS" ] && [ "$DNS" = "$PUB" ] && echo "  ok" || echo "  NOT READY — fix DNS (grey cloud) first"

hr "6. Certificate for $TURN_HOST"
ls -l /etc/nginx/ssl-certificates/ 2>/dev/null | grep -i turn || echo "  not issued yet (step 12.2)"

hr "7. LiveKit image / current ports"
docker compose ps livekit 2>/dev/null || docker ps --filter name=livekit
