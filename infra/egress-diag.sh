#!/usr/bin/env bash
# Egress / recording diagnostics. Run where docker-compose.yml lives:
#
#   bash infra/egress-diag.sh
#
# Read-only. Answers the two questions that explain almost every recording bug:
#
#   1. Does egress's headless Chrome have everything it needs to START?
#      It fetches our template over HTTP and the livekit-client bundle from
#      unpkg. If either fails, the page logs END_RECORDING in its catch block
#      and the recording stops seconds after it began.
#
#   2. Does the directory the BACKEND looks in equal the directory egress
#      WRITES to? The backend computes UPLOAD_DIR/meetings/livekit/<file>;
#      compose bind-mounts /out somewhere. If they differ, reconcile's
#      os.path.isfile() is always False and the row is never created — silently,
#      because that code path `continue`s without logging.

set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
hr() { printf '\n──────── %s ────────\n' "$1"; }

echo "Egress diagnostics — $(date -u '+%Y-%m-%d %H:%M:%SZ')"
echo "project dir: $(pwd)"

EG=$(docker compose ps -q egress 2>/dev/null); [ -z "$EG" ] && EG=$(docker ps -q --filter name=egress | head -1)
LK=$(docker compose ps -q livekit 2>/dev/null); [ -z "$LK" ] && LK=$(docker ps -q --filter name=livekit | head -1)

hr "1. Backend env that drives recording"
BE=""
for f in backend/.env /var/www/turaquant/backend/.env; do [ -f "$f" ] && BE="$f" && break; done
echo "backend env file: ${BE:-NOT FOUND}"
if [ -n "$BE" ]; then
  for k in UPLOAD_DIR EGRESS_TEMPLATE_BASE_URL LIVEKIT_URL LIVEKIT_ROOM_PREFIX; do
    printf '  %-24s %s\n' "$k" "$(grep -E "^$k=" "$BE" | cut -d= -f2- || echo '(unset)')"
  done
fi
UPLOAD_DIR=$(grep -E '^UPLOAD_DIR=' "${BE:-/dev/null}" 2>/dev/null | cut -d= -f2-)
TPL=$(grep -E '^EGRESS_TEMPLATE_BASE_URL=' "${BE:-/dev/null}" 2>/dev/null | cut -d= -f2-)

hr "2. Where egress actually writes  ← path mismatch check"
if [ -n "$EG" ]; then
  docker inspect "$EG" --format '{{range .Mounts}}  {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
  OUT=$(docker inspect "$EG" --format '{{range .Mounts}}{{if eq .Destination "/out"}}{{.Source}}{{end}}{{end}}')
else
  echo "  !! no egress container found"
fi
echo "egress /out on host : ${OUT:-UNKNOWN}"
EGRESS_HOST_DIR=$(grep -E '^EGRESS_HOST_DIR=' "${BE:-/dev/null}" 2>/dev/null | cut -d= -f2-)
UD="${UPLOAD_DIR%/}"
# Same order as livekit_service.egress_host_dirs(): EGRESS_HOST_DIR, then
# UPLOAD_DIR itself when it already ends in meetings/livekit, then UPLOAD_DIR/meetings/livekit.
if [ -n "$EGRESS_HOST_DIR" ]; then EXPECT="${EGRESS_HOST_DIR%/}"
else case "$UD" in
  */meetings/livekit) EXPECT="$UD" ;;
  /*) EXPECT="$UD/meetings/livekit" ;;
  "") EXPECT="(UPLOAD_DIR unset)" ;;
  *)  EXPECT="<cwd of the backend process>/$UD/meetings/livekit  (RELATIVE — depends on where uvicorn was started)" ;;
esac; fi
echo "backend looks in    : $EXPECT"
if [ -n "${OUT:-}" ] && [ "${EXPECT}" = "${OUT}" ]; then
  echo ">>> VERDICT: MATCH"
elif [ -n "${OUT:-}" ] && [ -n "$UPLOAD_DIR" ]; then
  echo ">>> VERDICT: ***MISMATCH — recordings will never appear in the UI.***"
  echo ">>>          The MP4 is written, but os.path.isfile() on the backend's"
  echo ">>>          computed path fails, so no DB row is ever created."
fi

hr "2b. Can egress WRITE to /out?  ← 'permission denied' / 'no such file or directory'"
if [ -n "$EG" ]; then
  echo "  egress runs as: $(docker exec "$EG" id 2>/dev/null)"
  if docker exec "$EG" sh -c 'f=/out/.egress-write-test; touch "$f" && rm -f "$f"' 2>/dev/null; then
    echo ">>> WRITABLE"
  else
    echo ">>> ***NOT WRITABLE*** — every recording will fail with 'permission denied' or"
    echo ">>>     'no such file or directory'."
  fi
  # A folder deleted & recreated after egress started leaves /out pointing at the
  # old (deleted) directory: same path, different inode.
  IN_HOST=$(stat -c %i "${OUT:-/nonexistent}" 2>/dev/null); IN_CT=$(docker exec "$EG" stat -c %i /out 2>/dev/null)
  echo "  inode host=${IN_HOST:-?} container=${IN_CT:-?}"
  if [ -n "$IN_HOST" ] && [ -n "$IN_CT" ] && [ "$IN_HOST" != "$IN_CT" ]; then
    echo ">>> ***STALE MOUNT*** — the folder was replaced after egress started."
    echo ">>>     Fix: docker restart $EG   (keeps its config; re-attaches the folder)"
  fi
fi

hr "3. What is actually on disk"
for d in "${OUT:-}" "$UPLOAD_DIR/meetings/livekit" backend/uploads/meetings/livekit; do
  [ -n "$d" ] && [ -d "$d" ] || continue
  echo "-- $d"
  ls -lh "$d" 2>/dev/null | tail -8
  echo "   (mp4 count: $(ls -1 "$d"/*.mp4 2>/dev/null | wc -l | tr -d ' '))"
done

hr "4. Can egress's Chrome reach what it needs?  ← the 7-second stop"
if [ -n "$EG" ]; then
  echo "-- our template: ${TPL:-(unset)}"
  if [ -n "$TPL" ]; then
    docker exec "$EG" curl -s -o /dev/null -m 10 -w "   HTTP %{http_code}  (200 = good; 000 = unreachable)\n" "$TPL" \
      || echo "   curl unavailable inside the container"
  fi
  echo "-- livekit-client bundle from unpkg (the template loads this):"
  docker exec "$EG" curl -s -o /dev/null -m 15 -w "   HTTP %{http_code}\n" \
    https://unpkg.com/livekit-client@2.20.1/dist/livekit-client.umd.js 2>/dev/null \
    || echo "   unreachable / no curl"
  echo "-- the SFU, over the compose network:"
  docker exec "$EG" curl -s -o /dev/null -m 10 -w "   HTTP %{http_code}\n" http://livekit:7880/ 2>/dev/null \
    || echo "   unreachable"
else
  echo "  (no egress container)"
fi
echo
echo "A 000 on the template is the classic cause: uvicorn bound to 127.0.0.1 is"
echo "NOT reachable from inside a container. It must listen on 0.0.0.0."

hr "5. Is the backend reachable on 0.0.0.0:8000?"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ':8000' || echo "  nothing listening on :8000"
echo "  ^ '127.0.0.1:8000' = egress CANNOT reach it. '0.0.0.0:8000' or '*:8000' = fine."

hr "6. Egress container log (last 60 lines)"
[ -n "$EG" ] && docker logs "$EG" --tail 60 2>&1 | cut -c1-320

hr "7. LiveKit's view of egress"
[ -n "$LK" ] && docker logs "$LK" 2>&1 | grep -iE 'egress|EG_' | tail -20 | cut -c1-320

hr "done"
echo "Sections 2 and 4 carry the verdicts. Paste the whole output."
