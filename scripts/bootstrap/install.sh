#!/usr/bin/env bash
set -euo pipefail

# Ensure minimal PATH for system utilities
if [ -z "${PATH:-}" ]; then
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi

echo "MemoryMesh installer (shell)"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_with_optional_sudo() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
    return
  fi

  if command_exists sudo; then
    sudo "$@"
    return
  fi

  echo "This step requires elevated privileges, but sudo is not available."
  return 1
}

print_node_guidance() {
  cat <<'EOF'
Node.js 18+ is required to install MemoryMesh CLI.

Suggested install options:
- macOS: `brew install node`
- Linux (Debian/Ubuntu): `sudo apt-get install -y nodejs npm`
- Linux (Fedora): `sudo dnf install -y nodejs npm`
- Linux (Arch): `sudo pacman -S nodejs npm`
- Official installer: https://nodejs.org/
EOF
}

print_npm_guidance() {
  cat <<'EOF'
npm is required to install MemoryMesh CLI.

Suggested remediation:
- Reinstall/upgrade Node.js LTS from https://nodejs.org/
- Ensure npm is in PATH: `npm --version`
EOF
}

install_prerequisites_if_supported() {
  case "$platform" in
    Darwin)
      if command_exists brew; then
        echo "Attempting best-effort prerequisite install via Homebrew..."
        brew install node
        return $?
      fi
      return 1
      ;;
    Linux)
      if command_exists apt-get; then
        echo "Attempting best-effort prerequisite install via apt-get..."
        run_with_optional_sudo apt-get update
        run_with_optional_sudo apt-get install -y nodejs npm
        return $?
      fi
      if command_exists dnf; then
        echo "Attempting best-effort prerequisite install via dnf..."
        run_with_optional_sudo dnf install -y nodejs npm
        return $?
      fi
      if command_exists pacman; then
        echo "Attempting best-effort prerequisite install via pacman..."
        run_with_optional_sudo pacman -Sy --noconfirm nodejs npm
        return $?
      fi
      return 1
      ;;
    *)
      return 1
      ;;
  esac
}

platform="$(uname -s)"
case "$platform" in
  Darwin|Linux) ;;
  *)
    echo "Unsupported platform: $platform"
    exit 1
    ;;
esac

echo "Checking prerequisites..."
if ! command_exists node || ! command_exists npm; then
  echo "Node.js and/or npm are missing. Attempting best-effort prerequisite bootstrap..."
  if ! install_prerequisites_if_supported; then
    echo "No supported package manager detected for automatic prerequisite install."
  fi
fi

if ! command_exists node; then
  echo "Missing prerequisite: Node.js"
  print_node_guidance
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
  echo "Node.js 18+ is required (found: ${node_major:-unknown})"
  print_node_guidance
  exit 1
fi

if ! command_exists npm; then
  echo "Missing prerequisite: npm"
  print_npm_guidance
  exit 1
fi

echo "Installing/updating MemoryMesh CLI globally..."
npm install -g @okutucu/memorymesh

if ! command -v memorymesh >/dev/null 2>&1; then
  echo "memorymesh command not found after install"
  exit 1
fi

echo "Starting MemoryMesh..."
memorymesh
