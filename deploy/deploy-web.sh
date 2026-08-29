#!/usr/bin/env bash
# Deploy ONLY the web app. Separate from deploy.sh on purpose: the frontend and
# the backend are worked on by different people at different times, and neither
# should have to rebuild the other to ship.
#
#   ./deploy-web.sh                 # build from ../frontend and deploy
#   TAG=... ./deploy-web.sh         # pin a tag
#   API=https://... ./deploy-web.sh # point the bundle at a different API
#
# NEXT_PUBLIC_DONALD_API is baked in at BUILD time, so changing the API means a
# rebuild, not a restart.
set -euo pipefail

HOST="${HOST:-45.33.12.143}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
SRC="${SRC:-$(cd "$(dirname "$0")/../frontend" && pwd)}"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
# Deliberately EMPTY by default.
#
# page.tsx picks apiSource() when NEXT_PUBLIC_DONALD_API is set and falls back to
# the recorded fixture when it is not — and apiSource currently targets endpoints
# that do not exist (`agent_events`, `sequence_gt`). Setting this today would ship
# a site that fails to load its data; leaving it empty ships the recorded demo,
# which works.
#
# Set it once the live source is rewritten:
#   API=https://api.donald.todes.mx ./deploy-web.sh
API="${API:-}"

SSH=(ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST")
export RSYNC_RSH="ssh -p $SSH_PORT -o StrictHostKeyChecking=accept-new"

if [ -z "$API" ]; then
  echo "==> NOTE: NEXT_PUBLIC_DONALD_API is empty — the app will play its recorded"
  echo "    fixture rather than live data. Pass API=... once apiSource is rewritten."
fi
echo "==> web deploy to $SSH_USER@$HOST   tag $TAG   api ${API:-<recorded fixture>}"
echo "==> source $SRC"

# node_modules and .next are excluded deliberately: they are large, they are
# platform-specific (the laptop is arm64 and the box amd64), and the image builds
# both from the lockfile anyway.
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  "$SRC/" "$SSH_USER@$HOST:/opt/donald/web-src/"
# Sync the charts too, so a web deploy never depends on a backend deploy having
# run first.
"${SSH[@]}" 'mkdir -p /opt/donald/.helm /opt/donald/scripts /opt/donald/web-src'
rsync -az --delete "$(dirname "$0")/.helm/" "$SSH_USER@$HOST:/opt/donald/.helm/"
rsync -az "$(dirname "$0")/web.Dockerfile" "$SSH_USER@$HOST:/opt/donald/web.Dockerfile"
rsync -az "$(dirname "$0")/scripts/04-build-web.sh" "$SSH_USER@$HOST:/opt/donald/scripts/04-build-web.sh"

"${SSH[@]}" "chmod +x /opt/donald/scripts/04-build-web.sh && /opt/donald/scripts/04-build-web.sh /opt/donald/web-src '$TAG' '$API'"

echo "==> helm upgrade donald-web"
"${SSH[@]}" "microk8s helm upgrade --install donald-web /opt/donald/.helm/donald-web \
  --namespace donald --create-namespace \
  --set image.tag='$TAG' \
  --wait --timeout 5m"

echo "==> rollout"
"${SSH[@]}" "microk8s kubectl -n donald rollout status deploy/donald-web --timeout=3m"

echo "==> smoke"
code=$(curl -s -o /dev/null -w '%{http_code}' https://donald.todes.mx/ || true)
echo "https://donald.todes.mx/  -> $code"
[ "$code" = "200" ] || { echo "NOT 200 — check: microk8s kubectl -n donald logs deploy/donald-web"; exit 1; }
echo "OK"
