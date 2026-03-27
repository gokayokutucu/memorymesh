#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ -z "$MODE" ]]; then
  echo "Usage: ./scripts/ship.sh [ci|release]"
  exit 1
fi

echo "Mode: $MODE"
echo "Branch: $BRANCH"

# -------------------------
# COMMON CHECKS
# -------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Working tree not clean. Commit or stash changes first."
  exit 1
fi

# -------------------------
# CI MODE
# -------------------------
if [[ "$MODE" == "ci" ]]; then
  echo "🚀 Running CI flow (commit + push)"

  git push

  echo "✅ CI triggered"
  exit 0
fi

# -------------------------
# RELEASE MODE
# -------------------------
if [[ "$MODE" == "release" ]]; then
  if [[ "$BRANCH" != "main" ]]; then
    echo "❌ Release can only be done from main branch"
    exit 1
  fi

  echo "🚀 Running RELEASE flow"

  # bump all workspace versions
  npm version patch --workspaces

  VERSION=$(node -p "require('./packages/cli/package.json').version")
  TAG="v${VERSION}"

  echo "Version: $VERSION"
  echo "Tag: $TAG"

  git add .
  git commit -m "chore(release): ${TAG}"
  git push

  git tag "$TAG"
  git push origin "$TAG"

  echo "✅ Release triggered: $TAG"
  exit 0
fi

echo "❌ Unknown mode: $MODE"
exit 1
