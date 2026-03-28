#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-full}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

step() {
  echo
  echo "==> $1"
}

usage() {
  cat <<'EOF'
Usage: ./scripts/local-smoke-reset.sh [clean|build|pack-install|full]

Modes:
  clean        uninstall global CLI + remove local state + remove generated tgz
  build        npm run build + npm test
  pack-install npm pack workspace + install generated tarball globally + basic smoke
  full         clean + build + pack-install (default)

Optional:
  MEMORYMESH_SMOKE_INTERACTIVE=1  Run `MEMORYMESH_USE_LOCAL_BUILD=true memorymesh` at the end of full mode.
EOF
}

clean() {
  step "Uninstall global MemoryMesh CLI (scoped + legacy unscoped)"
  require_command npm
  npm uninstall -g @okutucu/memorymesh memorymesh || true

  step "Remove local runtime state"
  rm -rf "${HOME}/.memorymesh" || true

  step "Remove local temp dirs"
  rm -rf .tmp-global .tmp-global-phase9a || true

  step "Remove generated tarballs in repo root"
  rm -f memorymesh-*.tgz okutucu-memorymesh-*.tgz || true

  step "Reset shell command hash"
  hash -r || true
}

build() {
  step "Build"
  require_command npm
  npm run build

  step "Test"
  npm test
}

pack_install() {
  step "Pack CLI workspace"
  require_command npm
  local tarball
  tarball="$(npm pack -w @okutucu/memorymesh)"
  if [ -z "${tarball}" ] || [ ! -f "${tarball}" ]; then
    echo "Failed to produce npm pack tarball"
    exit 1
  fi

  step "Install packed tarball globally"
  npm install -g "./${tarball}"

  step "Reset shell command hash"
  hash -r || true

  step "Verify memorymesh is available"
  require_command memorymesh
  which memorymesh
  memorymesh --help
}

case "${MODE}" in
  clean)
    clean
    ;;
  build)
    build
    ;;
  pack-install)
    pack_install
    ;;
  full)
    clean
    build
    pack_install

    if [ "${MEMORYMESH_SMOKE_INTERACTIVE:-}" = "1" ]; then
      step "Interactive smoke"
      MEMORYMESH_USE_LOCAL_BUILD=true memorymesh
    else
      step "Interactive smoke (optional)"
      echo "Run manually:"
      echo "  MEMORYMESH_USE_LOCAL_BUILD=true memorymesh"
      echo
      echo "Or run:"
      echo "  MEMORYMESH_SMOKE_INTERACTIVE=1 ./scripts/local-smoke-reset.sh full"
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown mode: ${MODE}"
    usage
    exit 1
    ;;
esac

