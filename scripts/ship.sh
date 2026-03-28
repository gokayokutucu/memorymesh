#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
VERSION_INPUT="${2:-}"
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
  echo "Usage: ./scripts/ship.sh [ci|release <X.Y.Z|patch|minor|major>|<X.Y.Z|patch|minor|major>]"
  exit 1
fi

if [[ "$MODE" != "ci" && "$MODE" != "release" ]]; then
  VERSION_INPUT="$MODE"
  MODE="release"
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
  if [[ -z "$VERSION_INPUT" ]]; then
    echo "❌ Missing version input."
    echo "Usage: ./scripts/ship.sh release <X.Y.Z|patch|minor|major>"
    exit 1
  fi

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

  if [[ "$VERSION_INPUT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    VERSION="$VERSION_INPUT"
    echo "Using manual version: $VERSION"
  elif [[ "$VERSION_INPUT" == "patch" || "$VERSION_INPUT" == "minor" || "$VERSION_INPUT" == "major" ]]; then
    CURRENT_VERSION="$(node -p "require('./packages/cli/package.json').version")"
    VERSION="$(node -e '
const current = process.argv[1];
const bump = process.argv[2];
const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(current);
if (!match) {
  console.error(`Invalid current version: ${current}`);
  process.exit(1);
}
const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]);
if (bump === "patch") {
  process.stdout.write(`${major}.${minor}.${patch + 1}`);
} else if (bump === "minor") {
  process.stdout.write(`${major}.${minor + 1}.0`);
} else if (bump === "major") {
  process.stdout.write(`${major + 1}.0.0`);
} else {
  console.error(`Invalid bump mode: ${bump}`);
  process.exit(1);
}
' "$CURRENT_VERSION" "$VERSION_INPUT")"
    echo "Auto bump ($VERSION_INPUT): $CURRENT_VERSION -> $VERSION"
  else
    echo "❌ Invalid input: $VERSION_INPUT"
    echo "Allowed: X.Y.Z | patch | minor | major"
    exit 1
  fi

  # deterministically update all intended package versions
  node -e '
const fs = require("fs");

const version = process.argv[1];
const files = process.argv.slice(2);
for (const file of files) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = version;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`Updated ${file} -> ${version}`);
}
' "$VERSION" \
    package.json \
    apps/server/package.json \
    packages/core/package.json \
    packages/runtime/package.json \
    packages/cli/package.json

  # regenerate package-lock deterministically after version updates
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund

  VERSION="$(node -p "require('./packages/cli/package.json').version")"
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
