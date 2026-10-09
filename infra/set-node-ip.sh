#!/usr/bin/env bash
# LiveKit advertises ONE IP in its ICE candidates, and both your browser and the
# Egress container's headless Chrome must reach it. 127.0.0.1 works for the
# browser but points Egress at itself ("Start signal not received"), so we use
# the host's LAN IP.
#
# That IP changes with the network, hence this script — re-run it after moving
# networks, then `docker compose up -d`. Do NOT hardcode: a stale value here is
# indistinguishable at runtime from a firewall problem.
#
# Interfaces are probed in order rather than assuming en0: on this machine the
# LAN is en5, and Wi-Fi/Ethernet/dock ordering differs per Mac.
set -euo pipefail

IP=""
if command -v ipconfig >/dev/null 2>&1; then          # macOS
  for iface in $(ifconfig -l); do
    case "$iface" in lo*|awdl*|llw*|utun*|bridge*|gif*|stf*) continue ;; esac
    candidate=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    if [ -n "$candidate" ]; then IP="$candidate"; break; fi
  done
else                                                   # Linux
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

[ -n "$IP" ] || { echo "Could not detect a LAN IP — are you online?" >&2; exit 1; }

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
touch "$ENV_FILE"
if grep -q '^LIVEKIT_NODE_IP=' "$ENV_FILE"; then
  sed -i.bak "s|^LIVEKIT_NODE_IP=.*|LIVEKIT_NODE_IP=$IP|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
  echo "LIVEKIT_NODE_IP=$IP" >> "$ENV_FILE"
fi
echo "LIVEKIT_NODE_IP=$IP  (written to $ENV_FILE)"
echo "Now restart the stack:  docker compose up -d"
