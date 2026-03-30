#!/usr/bin/env bash
set -euo pipefail

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

TARGET_DIR="${1:-memorymesh}"

require_command git
require_command docker
require_command npm

if [ -e "${TARGET_DIR}" ]; then
  echo "Target directory already exists: ${TARGET_DIR}"
  exit 1
fi

echo "Installing MemoryMesh..."
git clone https://github.com/gokayokutucu/memorymesh.git "${TARGET_DIR}"
cd "${TARGET_DIR}"

if [ ! -f ".env" ]; then
  cp .env.example .env
fi

npm install
npm run build
docker compose up -d

echo "MemoryMesh installed successfully!"
echo "Add to Claude Desktop config: see README.md"
