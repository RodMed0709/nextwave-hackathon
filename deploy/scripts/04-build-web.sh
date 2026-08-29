#!/usr/bin/env bash
# Run ON the Linode box, as root. Builds the web image and imports it into
# microk8s' containerd — the same shape as 02-build-image.sh, and the same two
# traps apply (containerd does not read Docker's store; the tag must be unique).
#
#   usage: 04-build-web.sh [SRC_DIR] [TAG] [API_BASE_URL]
set -euo pipefail

SRC="${1:-/opt/donald/web-src}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"
API="${3:-https://api.donald.todes.mx/v1}"
IMAGE="donald-web:${TAG}"

echo "==> building ${IMAGE} from ${SRC} (API ${API})"
docker build \
  -f /opt/donald/web.Dockerfile \
  --build-arg "NEXT_PUBLIC_DONALD_API=${API}" \
  -t "${IMAGE}" \
  "${SRC}"

echo "==> importing into microk8s containerd"
docker save "${IMAGE}" | microk8s ctr image import -

# `ctr image import` returns before the image reliably appears in `images ls`;
# see the same retry in 02-build-image.sh.
found=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if microk8s ctr images ls -q | grep -qx "docker.io/library/${IMAGE}"; then
    found="yes"
    [ "$attempt" -gt 1 ] && echo "    (visible after ${attempt} attempts)"
    break
  fi
  sleep 1
done
if [ -z "$found" ]; then
  echo "FAILED: docker.io/library/${IMAGE} is not in containerd after 10s"
  microk8s ctr images ls -q | grep donald-web || true
  exit 1
fi

mkdir -p /opt/donald
echo "$TAG" > /opt/donald/current-web-tag
echo "OK: ${IMAGE} imported"
