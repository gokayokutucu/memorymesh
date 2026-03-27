#!/usr/bin/env bash
set -euo pipefail

QDRANT_COLLECTION="${QDRANT_COLLECTION:-memories}"
QDRANT_HOST="${QDRANT_HOST:-localhost}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
MONGO_DB="${MONGO_DB:-memorymesh}"
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-neo4j}"
CHECKPOINT_DIR="${HOME}/.memorymesh/checkpoints"
AUDIT_DIR="${HOME}/.memorymesh/import-audit"
QDRANT_BASE_URL="http://${QDRANT_HOST}:${QDRANT_PORT}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'ERROR: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

reset_qdrant_collection() {
  local delete_url="${QDRANT_BASE_URL}/collections/${QDRANT_COLLECTION}"
  local delete_body
  local delete_code
  local verify_body
  local verify_code

  delete_body="$(mktemp)"
  if ! delete_code="$(curl -sS -o "${delete_body}" -w "%{http_code}" -X DELETE "${delete_url}")"; then
    printf 'ERROR: failed to reach Qdrant at %s\n' "${QDRANT_BASE_URL}" >&2
    rm -f "${delete_body}"
    exit 1
  fi

  case "${delete_code}" in
    200|202)
      printf 'Qdrant delete request succeeded (HTTP %s).\n' "${delete_code}"
      ;;
    404)
      printf 'Qdrant collection not found (already clean).\n'
      rm -f "${delete_body}"
      return 0
      ;;
    *)
      printf 'ERROR: Qdrant collection delete failed (HTTP %s).\n' "${delete_code}" >&2
      printf 'Qdrant response:\n%s\n' "$(cat "${delete_body}")" >&2
      rm -f "${delete_body}"
      exit 1
      ;;
  esac
  rm -f "${delete_body}"

  verify_body="$(mktemp)"
  if ! verify_code="$(curl -sS -o "${verify_body}" -w "%{http_code}" "${delete_url}")"; then
    printf 'ERROR: failed to verify Qdrant reset at %s\n' "${QDRANT_BASE_URL}" >&2
    rm -f "${verify_body}"
    exit 1
  fi

  case "${verify_code}" in
    404)
      printf 'Qdrant verification OK: collection "%s" is absent.\n' "${QDRANT_COLLECTION}"
      ;;
    200)
      printf 'ERROR: Qdrant verification failed: collection "%s" still exists.\n' "${QDRANT_COLLECTION}" >&2
      printf 'Qdrant response:\n%s\n' "$(cat "${verify_body}")" >&2
      rm -f "${verify_body}"
      exit 1
      ;;
    *)
      printf 'ERROR: unexpected Qdrant verification response (HTTP %s).\n' "${verify_code}" >&2
      printf 'Qdrant response:\n%s\n' "$(cat "${verify_body}")" >&2
      rm -f "${verify_body}"
      exit 1
      ;;
  esac
  rm -f "${verify_body}"
}

require_command curl

printf 'WARNING: This will DELETE all local MemoryMesh data\n'
printf 'Qdrant vectors, Mongo documents, Neo4j graph, checkpoints and audit logs will be removed.\n'
printf 'Type YES to continue\n'
read -r CONFIRM

if [ "${CONFIRM}" != "YES" ]; then
  printf 'Abort.\n'
  exit 1
fi

printf '\n[1/6] Resetting Qdrant collection: %s\n' "${QDRANT_COLLECTION}"
reset_qdrant_collection

printf '[2/6] Dropping MongoDB database: %s\n' "${MONGO_DB}"
docker compose exec -T mongodb \
  mongosh --quiet --eval "db.getSiblingDB('${MONGO_DB}').dropDatabase()" >/dev/null || true

printf '[3/6] Clearing Neo4j graph\n'
docker compose exec -T neo4j \
  cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" "MATCH (n) DETACH DELETE n" >/dev/null || true

printf '[4/6] Removing importer checkpoint and audit state\n'
mkdir -p "${CHECKPOINT_DIR}" "${AUDIT_DIR}"
rm -rf "${CHECKPOINT_DIR}"/*
rm -rf "${AUDIT_DIR}"/*

printf '[5/6] Removing local debug outputs\n'
rm -f temporary_test_output.log
rm -f temporary_consistency_audit.log

printf '[6/6] Service status\n'
docker compose ps || true

printf '\nMemoryMesh local state reset complete.\n'
printf 'You can now run a fresh import.\n'

printf '\nRebuilding and starting Docker Compose services...\n'
docker compose up -d --build
