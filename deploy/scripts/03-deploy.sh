#!/usr/bin/env bash
# Run ON the Linode box, as root. Creates the secrets and the config overlay,
# installs the four Helm releases, applies the database schema and VERIFIES it.
# Idempotent — safe to re-run.
#
#   usage: 03-deploy.sh [DEPLOY_DIR] [TAG]
#
# SECRETS: the two MySQL passwords are generated here, on the box, and stored
# only in /etc/donald/credentials.env (root, 0600), the donald-db Kubernetes
# Secret, and the config overlay at /etc/config/nuzur/donald/prod.yaml (root,
# 0600). Nothing is printed and nothing lands in the repo.
set -euo pipefail

DEPLOY="${1:-/opt/donald}"
TAG="${2:-}"
HELM_DIR="$DEPLOY/.helm"
NS=donald
CREDS=/etc/donald/credentials.env
OVERLAY_DIR=/etc/config/nuzur/donald

kube() { microk8s kubectl "$@"; }
helm3() { microk8s helm3 "$@"; }

if [ -z "$TAG" ]; then
  TAG="$(cat /opt/donald/current-tag 2>/dev/null || echo)"
fi
[ -n "$TAG" ] || { echo "no image tag: pass one, or run 02-build-image.sh first"; exit 1; }
echo "==> image tag: $TAG"

echo "==> namespace"
kube get namespace "$NS" >/dev/null 2>&1 || kube create namespace "$NS"

echo "==> credentials"
mkdir -p /etc/donald
if [ ! -f "$CREDS" ]; then
  {
    echo "MYSQL_ROOT_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 28)"
    echo "MYSQL_APP_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 28)"
    # Cloudflare R2. Empty on purpose — nobody supplied them. Fill in and re-run
    # to enable artifact uploads; until then /upload and /sign answer 503 and
    # everything else works.
    echo "R2_KEY_ID="
    echo "R2_SECRET="
  } > "$CREDS"
  chmod 600 "$CREDS"
  echo "    generated $CREDS"
else
  echo "    reusing $CREDS"
fi
# shellcheck disable=SC1090
set -a; . "$CREDS"; set +a

kube -n "$NS" create secret generic donald-db \
  --from-literal=root-password="$MYSQL_ROOT_PASSWORD" \
  --from-literal=app-password="$MYSQL_APP_PASSWORD" \
  --dry-run=client -o yaml | kube apply -f -

echo "==> config overlay at $OVERLAY_DIR/prod.yaml"
# The charts mount hostPath /etc/config at /root/hostconfig, so this file appears
# in the pod as /root/hostconfig/nuzur/donald/prod.yaml. It is mounted at
# /root/hostconfig and NOT /root/config because donald's own base.yaml lives at
# /root/config/base.yaml inside the image and would otherwise be shadowed.
mkdir -p "$OVERLAY_DIR"
umask 077
cat > "$OVERLAY_DIR/prod.yaml" <<YAML
db:
  - name: donald
    host: donald-mysql.${NS}.svc.cluster.local
    port: "3306"
    user: donald
    pswd: "${MYSQL_APP_PASSWORD}"
    params: "parseTime=true&interpolateParams=true&charset=utf8mb4"
    driver: "mysql"

aws:
  region: auto
  key_id: "${R2_KEY_ID}"
  secret: "${R2_SECRET}"
  bucket: nextwave-donald
  endpoint: "https://422d3de7d35153929e0564d10734ad7b.r2.cloudflarestorage.com"

monitoring:
  enabled: false
YAML
chmod 600 "$OVERLAY_DIR/prod.yaml"
umask 022

echo "==> mysql"
helm3 upgrade --install donald-mysql "$HELM_DIR/donald-mysql" -n "$NS" --wait --timeout 10m

echo "==> applying the donald schema"
POD=$(kube -n "$NS" get pod -l app.kubernetes.io/name=donald-mysql -o jsonpath='{.items[0].metadata.name}')
kube -n "$NS" exec -i "$POD" -- \
  env MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root donald < "$DEPLOY/schema.sql"

echo "==> verifying the schema (expecting 7 tables)"
TABLES=$(kube -n "$NS" exec "$POD" -- \
  env MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -N -B -e "SHOW TABLES IN donald;" | sort | tr '\n' ' ')
echo "    SHOW TABLES: $TABLES"
for t in agent_edge agent_event agent_node agent_run artifact client intervention; do
  case " $TABLES " in
    *" $t "*) ;;
    *) echo "MISSING TABLE: $t"; exit 1 ;;
  esac
done
# The app connects as `donald`, not root — prove that user can actually read.
kube -n "$NS" exec "$POD" -- \
  env MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -u donald -N -B -e "SELECT COUNT(*) FROM donald.client;" >/dev/null
echo "    schema OK, and the app user can read it"

echo "==> cert-manager issuers"
kube apply -f "$DEPLOY/cluster-issuer.yaml"

echo "==> app releases"
helm3 upgrade --install donald-api "$HELM_DIR/donald" -n "$NS" \
  -f "$HELM_DIR/donald/values-api.yaml" --set image.tag="$TAG" --wait --timeout 10m
helm3 upgrade --install donald-mcp "$HELM_DIR/donald" -n "$NS" \
  -f "$HELM_DIR/donald/values-mcp.yaml" --set image.tag="$TAG" --wait --timeout 10m
helm3 upgrade --install donald-web "$HELM_DIR/donald-web" -n "$NS" --wait --timeout 10m

echo
echo "==> in-cluster smoke test"
kube -n "$NS" run "smoke-$RANDOM" --rm -i --restart=Never --image=curlimages/curl:8.10.1 -- \
  sh -c 'curl -sS -o /dev/null -w "donald-api  /healthz     -> %{http_code}\n" http://donald-api.donald.svc.cluster.local:8080/healthz;
         curl -sS -o /dev/null -w "donald-api  /v1/clients  -> %{http_code}\n" "http://donald-api.donald.svc.cluster.local:8080/v1/clients?page_size=1";
         curl -sS -o /dev/null -w "donald-mcp  /v1/mcp init -> %{http_code}\n" -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"version\":\"0\"}}}" http://donald-mcp.donald.svc.cluster.local:8080/v1/mcp;
         curl -sS -o /dev/null -w "donald-web  /            -> %{http_code}\n" http://donald-web.donald.svc.cluster.local:8080/' || true

echo
echo "==> certificates (HTTP-01 can take a minute)"
kube -n "$NS" get certificate
echo
kube -n "$NS" get pods,svc,ingress
echo "OK"
