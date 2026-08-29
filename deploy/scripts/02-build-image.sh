#!/usr/bin/env bash
# Run ON the Linode box, as root. Builds the donald image and imports it into
# microk8s' containerd.
#
#   usage: 02-build-image.sh [SRC_DIR] [TAG]
#
# There is no registry (the user chose local build + import over GHCR). The two
# traps that follow from that, both handled here:
#
#  1. microk8s does NOT read the host Docker daemon's image store. An image that
#     only exists in Docker gives ImagePullBackOff. It has to be imported into
#     containerd, which is what the `ctr image import` below does — and the
#     script verifies it landed rather than assuming.
#  2. The tag MUST be unique per build. With image.pullPolicy: IfNotPresent and a
#     mutable tag like `latest`, a re-import leaves the kubelet happily running
#     the old layers and you debug a fix that was never deployed. So the default
#     tag is a timestamp, and 03-deploy.sh passes it to helm as image.tag.
#
# Building on the box (not the laptop) is deliberate: the box is amd64 and the
# laptop is arm64, and g6-dedicated-2's 4 GiB is comfortably above what the
# in-image `go build` needs.
set -euo pipefail

SRC="${1:-/opt/donald/src}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"
IMAGE="donald:${TAG}"

test -f "$SRC/Dockerfile" || { echo "no Dockerfile in $SRC"; exit 1; }

echo "==> building $IMAGE from $SRC"
docker build -t "$IMAGE" "$SRC"

echo "==> importing into microk8s containerd"
docker save "$IMAGE" | microk8s ctr image import -

echo "==> verifying the image is visible to the kubelet"
# containerd normalises `donald:TAG` to `docker.io/library/donald:TAG`, which is
# also what the kubelet resolves the chart's `image: donald:TAG` to.
if ! microk8s ctr images ls -q | grep -qx "docker.io/library/${IMAGE}"; then
  echo "FAILED: docker.io/library/${IMAGE} is not in containerd"
  microk8s ctr images ls -q | grep donald || true
  exit 1
fi

mkdir -p /opt/donald
echo "$TAG" > /opt/donald/current-tag
echo "OK: docker.io/library/${IMAGE} imported (tag written to /opt/donald/current-tag)"
