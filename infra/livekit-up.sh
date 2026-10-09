#!/usr/bin/env bash
# Start (or restart) TuraQuant's LiveKit stack with the CURRENT LAN IP.
#
# Always use this instead of a bare `docker compose up -d`. LiveKit bakes its
# node IP into every ICE candidate it advertises, so after a network change the
# old address is handed to browsers and every connection fails with
# "could not establish pc connection" — signalling still works, which makes it
# look like an app bug rather than a stale IP.
#
# Two things a plain `up -d` gets wrong:
#   * it does not re-read .env for a changed LIVEKIT_NODE_IP;
#   * it reports "Running" and skips reloading infra/livekit.yaml edits.
# --force-recreate fixes both.
set -euo pipefail
cd "$(dirname "$0")/.."

OLD=$(grep -E '^LIVEKIT_NODE_IP=' .env 2>/dev/null | cut -d= -f2 || true)
./infra/set-node-ip.sh >/dev/null
NEW=$(grep -E '^LIVEKIT_NODE_IP=' .env | cut -d= -f2)
[ "$OLD" != "$NEW" ] && echo "node IP changed: ${OLD:-unset} -> $NEW"

docker compose up -d --force-recreate livekit egress redis >/dev/null 2>&1
sleep 3
echo "LiveKit now advertising:"
docker logs turaquant-livekit-1 2>&1 | grep "starting LiveKit server" | tail -1 \
  | sed 's/.*"nodeIP": "\([^"]*\)".*rtc.portTCP": \([0-9]*\).*/  nodeIP=\1  tcp=\2/'
echo "Reachable: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:7890) on :7890"
