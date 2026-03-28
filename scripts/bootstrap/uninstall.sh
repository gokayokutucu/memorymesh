#!/usr/bin/env bash
set -euo pipefail

YES_MODE=false
if [[ "${1:-}" == "--yes" ]]; then
  YES_MODE=true
elif [[ -n "${1:-}" ]]; then
  echo "Usage: ./scripts/bootstrap/uninstall.sh [--yes]"
  exit 1
fi

if [ -z "${PATH:-}" ]; then
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi

HOME_DIR="${HOME:-}"
RUNTIME_HOME="${HOME_DIR}/.memorymesh"
COMPOSE_FILE="${RUNTIME_HOME}/stack/docker-compose.yml"
COMPOSE_PROJECT_DIR="${RUNTIME_HOME}/stack"

removed_packages=0
removed_containers=0
removed_volumes=0
removed_images=0
removed_runtime_home=0

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_banner() {
  cat <<'BANNER'
MemoryMesh Uninstaller (shell)

This will remove:
- Global npm packages: @okutucu/memorymesh and legacy memorymesh (if installed)
- Local runtime/install state: ~/.memorymesh
- MemoryMesh-related Docker containers, volumes, and images
BANNER
}

confirm_uninstall() {
  if [[ "$YES_MODE" == true ]]; then
    return 0
  fi

  printf "Continue with uninstall? [y/N]: "
  read -r answer
  case "${answer:-}" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      echo "Uninstall cancelled. No changes made."
      exit 0
      ;;
  esac
}

uninstall_npm_package_if_present() {
  local pkg="$1"
  if ! command_exists npm; then
    echo "npm not found; skipping global npm package removal."
    return 0
  fi

  if npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
    echo "Removing global npm package: $pkg"
    npm uninstall -g "$pkg" >/dev/null
    removed_packages=$((removed_packages + 1))
  else
    echo "Global npm package not installed: $pkg"
  fi
}

remove_runtime_home_if_present() {
  if [[ -d "$RUNTIME_HOME" ]]; then
    echo "Removing runtime home: $RUNTIME_HOME"
    rm -rf "$RUNTIME_HOME"
    removed_runtime_home=1
  else
    echo "Runtime home not found: $RUNTIME_HOME"
  fi
}

remove_docker_by_name() {
  local name="$1"
  local ids
  ids="$(docker ps -aq --filter "name=^${name}$")"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    docker rm -f $ids >/dev/null
    local count
    count="$(printf '%s\n' "$ids" | wc -w | tr -d ' ')"
    removed_containers=$((removed_containers + count))
  fi
}

remove_docker_volume_by_name() {
  local name="$1"
  if docker volume inspect "$name" >/dev/null 2>&1; then
    docker volume rm "$name" >/dev/null
    removed_volumes=$((removed_volumes + 1))
  fi
}

remove_docker_image_if_present() {
  local image_ref="$1"
  local ids
  ids="$(docker image ls -q "$image_ref" 2>/dev/null || true)"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    docker rmi -f $ids >/dev/null || true
    local count
    count="$(printf '%s\n' "$ids" | wc -w | tr -d ' ')"
    removed_images=$((removed_images + count))
  fi
}

cleanup_docker_resources() {
  if ! command_exists docker; then
    echo "Docker not found; skipping Docker cleanup."
    return 0
  fi

  if [[ -f "$COMPOSE_FILE" ]]; then
    echo "Bringing down managed stack: $COMPOSE_FILE"
    docker compose -f "$COMPOSE_FILE" --project-directory "$COMPOSE_PROJECT_DIR" down --volumes --remove-orphans >/dev/null || true
  fi

  echo "Removing known MemoryMesh containers (if present)..."
  remove_docker_by_name "stack-memorymesh-1"
  remove_docker_by_name "stack-qdrant-1"
  remove_docker_by_name "stack-ollama-1"
  remove_docker_by_name "stack-ollama-model-init-1"
  remove_docker_by_name "stack-mongodb-1"
  remove_docker_by_name "stack-neo4j-1"

  echo "Removing known MemoryMesh volumes (if present)..."
  remove_docker_volume_by_name "stack_qdrant_storage"
  remove_docker_volume_by_name "stack_ollama_models"
  remove_docker_volume_by_name "stack_mongodb_data"
  remove_docker_volume_by_name "stack_neo4j_data"

  echo "Removing MemoryMesh server images (if present)..."
  remove_docker_image_if_present "memorymesh/server:local-dev"
  remove_docker_image_if_present "ghcr.io/gokayokutucu/memorymesh-server:latest"
  remove_docker_image_if_present "ghcr.io/memorymesh/server:latest"
  remove_docker_image_if_present "memorymesh-memorymesh:latest"
}

verify_command_removed() {
  if command -v memorymesh >/dev/null 2>&1; then
    echo "❌ memorymesh command is still available: $(command -v memorymesh)"
    return 1
  fi

  echo "✅ memorymesh command is no longer available."
  return 0
}

print_summary() {
  echo ""
  echo "Uninstall summary"
  echo "- npm packages removed: ${removed_packages}"
  echo "- runtime home removed: ${removed_runtime_home}"
  echo "- docker containers removed: ${removed_containers}"
  echo "- docker volumes removed: ${removed_volumes}"
  echo "- docker images removed: ${removed_images}"
}

print_banner
confirm_uninstall

echo "Removing global CLI packages..."
uninstall_npm_package_if_present "@okutucu/memorymesh"
uninstall_npm_package_if_present "memorymesh"

echo "Removing local runtime state..."
remove_runtime_home_if_present

echo "Cleaning Docker resources..."
cleanup_docker_resources

hash -r || true

print_summary
verify_command_removed
