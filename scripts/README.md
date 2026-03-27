# 🚀 MemoryMesh Release Helper

This script provides a simple, safe way to trigger CI and Release workflows for the MemoryMesh repository.

---

## 📦 Location

`scripts/ship.sh`

Make sure it is executable:

```bash
chmod +x scripts/ship.sh
```

---

## 🧠 Concepts

There are two modes:

| Mode | Purpose |
|---|---|
| `ci` | Push current branch to trigger CI |
| `release` | Create version + tag + trigger Release |

---

## ⚙️ Usage

### 🔹 CI Mode

Triggers CI by pushing current branch.

```bash
./scripts/ship.sh ci
```

✔ No version bump  
✔ No tag creation  
✔ Works on any branch

---

### 🔹 Release Mode

Triggers a full release.

```bash
./scripts/ship.sh release
```

What it does:

1. Ensures you are on `main`
2. Ensures working tree is clean
3. Runs:

```bash
npm version patch --workspaces
```

4. Reads version from:

`packages/cli/package.json`

5. Creates tag:

`vX.Y.Z`

6. Pushes commit + tag

This triggers:

- GitHub Release workflow
- npm publish
- GHCR Docker publish

---

## 🔐 Safety Guards

The script will fail if:

- You are not on `main` (for release)
- Your working directory is not clean
- Version/tag mismatch would occur

---

## 🧩 Versioning Strategy

- Single source of truth: `packages/cli/package.json`
- All workspaces are versioned together
- Tag format: `vX.Y.Z`

Example:

`0.1.1 → v0.1.1`

---

## 🧪 Example Flow

### Development

```bash
git checkout feature/something
# do work
./scripts/ship.sh ci
```

### Release

```bash
git checkout main
git pull
./scripts/ship.sh release
```

---

## ⚠️ Notes

- Do not manually create tags
- Do not manually edit versions before release
- Always use the script for consistency

---

## 🚀 Future Improvements

- Conventional commits → automatic version bump
- npm trusted publishing (OIDC)
- changelog generation

---

## Local Smoke Reset (Developer Helper)

`scripts/local-smoke-reset.sh` is a local-only helper script for troubleshooting and quick smoke verification.
It is not part of the release flow.

Modes:

```bash
./scripts/local-smoke-reset.sh clean
./scripts/local-smoke-reset.sh build
./scripts/local-smoke-reset.sh pack-install
./scripts/local-smoke-reset.sh full
```

Optional interactive smoke (manual):

```bash
MEMORYMESH_SMOKE_INTERACTIVE=1 ./scripts/local-smoke-reset.sh full
```
