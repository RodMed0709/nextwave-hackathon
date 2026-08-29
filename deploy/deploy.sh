#!/usr/bin/env bash
# Run from the laptop. One command: sync source + charts to the box, build and
# import the image there, install the Helm releases, apply and verify the schema.
#
#   ./deploy.sh                   # full deploy
#   ./deploy.sh --skip-bootstrap  # skip the microk8s/ingress/cert-manager install
#
# Env overrides:
#   HOST=45.33.12.143  SSH_PORT=22  SSH_USER=root  SRC=../backend/donald  TAG=...
set -euo pipefail

HOST="${HOST:-45.33.12.143}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC:-$HERE/../backend/donald}"
# A distinct tag per build. Do NOT replace this with `latest`: the image is
# imported into containerd, not pulled, and with pullPolicy IfNotPresent a
# reused tag leaves the kubelet running the previous build.
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"

SSH=(ssh -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST")
RSYNC_RSH="ssh -p $SSH_PORT -o StrictHostKeyChecking=accept-new"

echo "==> target $SSH_USER@$HOST:$SSH_PORT   tag $TAG"
"${SSH[@]}" 'echo connected: $(hostname)'

echo "==> syncing source, charts and schema"
"${SSH[@]}" 'mkdir -p /opt/donald/src /opt/donald/.helm /opt/donald/scripts'
rsync -az --delete -e "$RSYNC_RSH" \
  --exclude '.git' --exclude '.DS_Store' --exclude 'nuzur-*' \
  "$SRC/" "$SSH_USER@$HOST:/opt/donald/src/"
rsync -az --delete -e "$RSYNC_RSH" "$HERE/.helm/"   "$SSH_USER@$HOST:/opt/donald/.helm/"
rsync -az --delete -e "$RSYNC_RSH" "$HERE/scripts/" "$SSH_USER@$HOST:/opt/donald/scripts/"
rsync -az -e "$RSYNC_RSH" "$HERE/schema.sql" "$HERE/cluster-issuer.yaml" \
  "$SSH_USER@$HOST:/opt/donald/"
"${SSH[@]}" 'chmod +x /opt/donald/scripts/*.sh'

if [ "${1:-}" != "--skip-bootstrap" ]; then
  echo "==> bootstrapping the box (docker, microk8s, addons, ingress-nginx)"
  "${SSH[@]}" '/opt/donald/scripts/01-bootstrap-box.sh'
fi

echo "==> building and importing the image on the box"
"${SSH[@]}" "/opt/donald/scripts/02-build-image.sh /opt/donald/src '$TAG'"

echo "==> deploying"
"${SSH[@]}" "/opt/donald/scripts/03-deploy.sh /opt/donald '$TAG'"

echo
echo "==> external smoke test"
for u in https://api.donald.todes.mx/healthz \
         "https://api.donald.todes.mx/v1/clients?page_size=1" \
         https://mcp.donald.todes.mx/healthz \
         https://donald.todes.mx/ ; do
  printf '%-58s -> ' "$u"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "$u" || echo FAILED
done
echo
echo "MCP endpoint: https://mcp.donald.todes.mx/v1/mcp"
