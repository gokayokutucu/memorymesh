#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
VERSION_FILES=(
  package.json
  package-lock.json
  apps/server/package.json
  packages/core/package.json
  packages/runtime/package.json
  packages/cli/package.json
)

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
  git fetch origin main --tags

  if ! git merge-base --is-ancestor HEAD origin/main; then
    echo "❌ Local main must be based on origin/main before release"
    exit 1
  fi

  if ! git diff --quiet HEAD origin/main; then
    echo "❌ Local main is not in sync with origin/main. Pull/rebase first."
    exit 1
  fi

  # bump all workspace versions
  npm version patch --workspaces

  VERSION=$(node -p "require('./packages/cli/package.json').version")
  TAG="v${VERSION}"

  echo "Version: $VERSION"
  echo "Tag: $TAG"

  if git rev-parse --verify --quiet "$TAG" >/dev/null; then
    echo "❌ Tag already exists locally: $TAG"
    exit 1
  fi

  if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
    echo "❌ Tag already exists on origin: $TAG"
    exit 1
  fi

  git add "${VERSION_FILES[@]}"
  git commit -m "chore(release): ${TAG}"
  git push

  git tag "$TAG"
  git push origin "$TAG"

  echo "✅ Release triggered: $TAG"
  exit 0
fi

echo "❌ Unknown mode: $MODE"
exit 1
