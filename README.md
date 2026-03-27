# MemoryMesh

## What is MemoryMesh

MemoryMesh is a local-first memory stack for AI workflows. It ships a CLI (`memorymesh`) that installs and manages a Docker-based runtime (MemoryMesh API, MongoDB, Neo4j, Qdrant, Ollama), plus CLI flows for setup, diagnostics, lifecycle, GPT archive import, and document import.

## Install

Global npm install:

```bash
npm install -g @okutucu/memorymesh
memorymesh
```

Notes:

- Package name is `@okutucu/memorymesh`
- First run launches interactive setup if `~/.memorymesh/config.json` is missing
- Published tarball includes required internal runtime modules for standalone install

## Bootstrap Install

macOS / Linux:

```bash
curl -fsSL https://github.com/gokayokutucu/memorymesh/releases/latest/download/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://github.com/gokayokutucu/memorymesh/releases/latest/download/install.ps1 | iex
```

Bootstrap behavior:

- Installs/updates the `memorymesh` CLI globally
- Launches `memorymesh` after install
- Attempts best-effort prerequisite installation where supported
- Prints explicit platform guidance when prerequisites cannot be auto-installed

Prerequisites (current phase):

- Node.js 18+
- npm in `PATH`
- Docker Desktop / Docker Engine

Important:

- Bootstrap scripts do not guarantee universal automatic prerequisite installation

## Runtime Modes

Current product state:

- `docker` mode: active and supported
- `native` mode: visible in roadmap, currently disabled / not implemented

## First Run Setup

When no install config is present, running `memorymesh` starts setup wizard flow:

1. Docker checks (`docker --version`, `docker info`)
2. Embedding selection (`flash` or `medium`)
3. Runtime config persistence under `~/.memorymesh`
4. Stack startup with Docker Compose
5. Ollama readiness + model pull
6. Health verification
7. Optional Claude Desktop MCP integration

Installer-managed runtime home:

```text
~/.memorymesh/
  config.json
  runtime.env
  stack/
    docker-compose.yml
```

### Embedding Configuration Authority

MemoryMesh uses a single source of truth for embedding settings:

`~/.memorymesh/config.json` -> generated `~/.memorymesh/runtime.env` -> runtime execution

Rules:

- Change embedding mode/model by re-running setup (`memorymesh`)
- Advanced users may edit `~/.memorymesh/config.json` directly
- `runtime.env` is generated automatically from `config.json`
- If drift is detected, MemoryMesh regenerates `runtime.env`
- Do not modify embedding via environment variables in normal usage; these values are managed automatically by MemoryMesh

Advanced note:

- Embedding env vars can exist for internal transport/debugging, but they are not a supported user configuration surface

## Core Commands

| Command | What it does | When to use | Caveats |
|---|---|---|---|
| `memorymesh` | Runs first-run setup if needed, otherwise opens runtime menu | Normal entrypoint | Requires working Docker stack for runtime actions |
| `memorymesh doctor` | Runs diagnostics and prints PASS/WARN/FAIL | Health checks and triage | Returns non-zero on critical failures |
| `memorymesh doctor --fix` | Attempts safe automatic repairs, then rechecks | Repair common issues quickly | Conservative fixes only; may still require manual action |
| `memorymesh start` | Starts managed Docker stack | Bring services up | Uses installer-managed stack context |
| `memorymesh stop` | Stops managed Docker stack | Pause local runtime | Stack artifacts are preserved |
| `memorymesh reset` | Stops stack and removes containers/volumes (based on flags) | Clean stack state | Confirm destructive flags carefully |
| `memorymesh uninstall` | Stops stack and removes `~/.memorymesh` | Full local removal | Destructive; use `--yes` for non-interactive |
| `memorymesh upgrade` | Upgrade scaffold command | Future upgrade path | Placeholder/scaffold in current phase |
| `memorymesh mcp` | Starts MCP stdio bridge | Claude/Desktop or MCP client integration | Long-running foreground process |
| `memorymesh import:gpt --path <file-or-folder>` | Imports ChatGPT export JSON/ZIP paths | Bring existing chat memory into MemoryMesh | Requires runtime availability and valid source files |
| `memorymesh import:documents --path <file-or-folder>` | Imports local documents (file or folder) | Ingest notes, markdown, CSV/JSON datasets, and searchable project docs | Recursive folder scan; unsupported files are skipped |

## Document Import

`import:documents` imports local files into MemoryMesh, recursively scans folders, parses supported formats, chunks text-based content where needed, and stores source metadata for source-aware search/retrieval.

Supported formats:

- `.txt`
- `.md`
- `.csv`
- `.json`
- `.jsonl`
- `.ndjson`

Run modes:

- Interactive: run `memorymesh`, then choose `Import documents`
- Direct command: `memorymesh import:documents --path <file-or-folder> [options]`

Detailed document-import limits, policies, project scoping, and checkpoint behavior are documented in [`packages/cli/README.md`](./packages/cli/README.md).

## Claude MCP Integration

Setup can patch Claude Desktop config with:

```json
{
  "mcpServers": {
    "memorymesh": {
      "command": "memorymesh",
      "args": ["mcp"]
    }
  }
}
```

Current integration behavior:

- Detects macOS and Windows Claude config paths
- Preserves unrelated config fields
- Handles missing config safely
- Fails safely on invalid JSON
- Shows restart guidance after successful update

## Diagnostics

`memorymesh doctor` includes checks for:

- Docker installed / daemon reachable
- MemoryMesh stack services (memorymesh, mongodb, neo4j, qdrant, ollama)
- MemoryMesh HTTP health
- Install/runtime config validity
- Embedding model presence
- Claude MCP config state

`memorymesh doctor --fix` can attempt safe repairs such as:

- Restarting stack
- Re-pulling embedding model
- Regenerating runtime env from install config
- Repairing Claude MCP config entry

## Troubleshooting

### Embedding model mismatch

This happens when existing vector data was created with a different embedding dimension (for example 768 vs 1024).

Resolution:

1. Run `memorymesh` to re-enter setup
2. Choose the target embedding mode (`flash` or `medium`)
3. Confirm reset when prompted if existing data must be rebuilt

Do not try to fix mismatch by manually exporting embedding environment variables.

1. Docker not installed
- Install Docker Desktop/Engine, then run `memorymesh doctor`

2. Docker daemon not running
- Start Docker Desktop/daemon, then run `memorymesh start`

3. Ollama model missing
- Run `memorymesh doctor --fix` or pull model via stack path, then re-run doctor

4. MemoryMesh health check fails
- Run `memorymesh doctor`; inspect stack status and restart with `memorymesh start`

5. Claude config missing
- This is non-destructive; create/open Claude Desktop once, then re-run integration

6. Claude config invalid JSON
- Fix JSON manually, then rerun installer or `memorymesh doctor --fix`

7. MCP integration not visible in Claude
- Confirm config contains `mcpServers.memorymesh`, then restart Claude Desktop

8. Bootstrap script cannot install prerequisites
- Use script guidance output to install Node/npm manually, then rerun script

9. `memorymesh` command not found after install
- Verify npm global bin is on `PATH`; reinstall with `npm install -g @okutucu/memorymesh`

10. npm install succeeds but runtime stack is unhealthy
- Run `memorymesh doctor` for root cause, then `memorymesh doctor --fix` for safe repairs and recheck

11. self-contained tarball/global install reports `EEXIST` binary conflict
- Remove conflicting global binary/package, or reinstall with a clean prefix, then run `npm install -g @okutucu/memorymesh`

## Development / Monorepo Notes

Repository layout:

- `apps/server`: server package
- `packages/core`: shared types/utilities
- `packages/runtime`: shared runtime/infrastructure
- `packages/cli`: install/runtime CLI

Useful development commands:

```bash
npm run build
npm test
npm run build -w @okutucu/memorymesh
npm test -w @okutucu/memorymesh
```

Release/distribution notes (current state):

- npm package target: `@okutucu/memorymesh`
- bootstrap scripts are published as release assets (`install.sh`, `install.ps1`)
- release automation is scaffolded; treat it as evolving, not fully hands-off
