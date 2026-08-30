#!/usr/bin/env bash
#
# Install (or rotate) the OpenAI key the suggestions endpoint uses.
#
# The key is read from the environment or typed at a prompt and goes straight
# into a Kubernetes Secret. It is never written to a file, never echoed, and
# never passed as a command-line argument — an argument would be visible in the
# process list and in your shell history, and this repository is public.
#
#   OPENAI_API_KEY=sk-... ./scripts/05-openai-secret.sh
#   ./scripts/05-openai-secret.sh          # prompts, input hidden
#
# Afterwards, restart the API pods so they pick it up:
#   kubectl -n donald rollout restart deployment/donald-api
set -euo pipefail

NAMESPACE="${NAMESPACE:-donald}"
SECRET="${SECRET:-donald-openai}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -rsp "OpenAI API key (input hidden): " OPENAI_API_KEY
  echo
fi

if [[ -z "${OPENAI_API_KEY}" ]]; then
  echo "No key given; nothing to do." >&2
  exit 1
fi

kubectl create secret generic "${SECRET}" \
  --namespace "${NAMESPACE}" \
  --from-literal=api-key="${OPENAI_API_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secret ${SECRET} is in place in namespace ${NAMESPACE}."
echo "Restart the API to pick it up:  kubectl -n ${NAMESPACE} rollout restart deployment/donald-api"
