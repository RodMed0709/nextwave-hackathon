#!/usr/bin/env bash
# Run ON the Linode box, as root. Idempotent — safe to re-run.
#
# Installs microk8s, Helm, the addons donald needs, and Docker (used ONLY as the
# image builder — the cluster runtime is microk8s' own containerd).
set -euo pipefail

echo "==> swap"
# The box is 2 vCPU / 4 GiB and only ~3 GiB is free once microk8s' API server,
# kubelet and containerd are resident. The memory-hungry step is the in-image
# `go build ./... && go build .`, and the nuzur deployment reference warns that a
# small box OOMs during `docker build`. An OOM kill surfaces as a bare
# "signal: killed" / exit 137 rather than a compile error, so it is easy to
# misdiagnose — add swap up front instead.
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -qxF '/swapfile none swap sw 0 0' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    added 4G /swapfile"
else
  echo "    /swapfile already active"
fi
free -h

echo "==> apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io rsync
systemctl enable --now docker

echo "==> microk8s"
if ! snap list microk8s >/dev/null 2>&1; then
  snap install microk8s --classic --channel=1.31/stable
fi
microk8s status --wait-ready --timeout 300

echo "==> addons"
# dns              : CoreDNS, so the app resolves the donald-mysql Service
# hostpath-storage : PVC backing for MySQL, on the node's disk
# cert-manager     : Let's Encrypt certificates for the three hostnames
# helm3            : these components are Helm charts, matching the nuzur-go repo
#
# NOTE: the microk8s `ingress` addon is deliberately NOT used. It is ingress-nginx,
# but it registers its IngressClass as `public`, and every chart in this org sets
# `ingress.className: "nginx"`. Rather than diverge from house style on one box,
# ingress-nginx is installed from its own chart below so the class really is
# `nginx`. The annotations (nginx.ingress.kubernetes.io/...) are identical either way.
for a in dns hostpath-storage cert-manager helm3; do
  if ! microk8s status --format short 2>/dev/null | grep -q "core/$a: enabled"; then
    echo "    enabling $a"
    microk8s enable "$a"
  else
    echo "    $a already enabled"
  fi
done
microk8s status --wait-ready --timeout 300

echo "==> ingress-nginx (IngressClass: nginx)"
microk8s helm3 repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
microk8s helm3 repo update >/dev/null
# Single node, so the controller runs as a DaemonSet on hostPorts 80/443 rather
# than behind a LoadBalancer there is nothing to provision.
microk8s helm3 upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.kind=DaemonSet \
  --set controller.hostPort.enabled=true \
  --set controller.service.enabled=false \
  --set controller.ingressClassResource.name=nginx \
  --set controller.ingressClassResource.default=true \
  --set controller.ingressClass=nginx \
  --set controller.publishService.enabled=false \
  --set controller.resources.requests.cpu=100m \
  --set controller.resources.requests.memory=128Mi \
  --set controller.resources.limits.cpu=500m \
  --set controller.resources.limits.memory=256Mi \
  --wait --timeout 10m

echo "==> waiting for cert-manager"
microk8s kubectl -n cert-manager rollout status deploy/cert-manager --timeout=300s
microk8s kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s

echo "==> kubectl / helm shims"
snap alias microk8s.kubectl kubectl 2>/dev/null || true
snap alias microk8s.helm3 helm     2>/dev/null || true

echo "OK: box bootstrapped"
microk8s kubectl get nodes -o wide
microk8s kubectl get ingressclass
