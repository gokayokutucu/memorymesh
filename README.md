# MemoryMesh

Local-first persistent memory ecosystem for AI assistants.

## Packages

| Package | Description |
|---------|-------------|
| `apps/server` | MCP memory server (Qdrant + MongoDB + Neo4j + Ollama) |
| `packages/core` | Shared types and utilities |
| `packages/runtime` | Shared runtime/infrastructure layer used by server and CLI |
| `packages/cli` | Import tools (GPT export, etc.) |

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/gokayokutucu/memorymesh/main/install.sh | sh
```

Requirements: Docker Desktop, Node.js 18+

## Docker Compose Configuration Source

For local Docker runs, MemoryMesh uses a single `.env` file as the primary configuration source.

The `memorymesh` service loads `.env` via `docker-compose.yml` `env_file`, so `MEMORYMESH_*` runtime settings (mode, retry, retrieval, profiler) are injected directly into the container.

After changing `.env`, apply changes with:

```bash
docker compose up -d --build
```

Then reconnect MCP clients (for example Claude Desktop) so tool registration changes are visible.

Docker networking caveat:
- in Docker Compose mode, inter-container hosts must use service names (`qdrant`, `mongodb`, `neo4j`, `ollama`)
- host-run mode can use `localhost`
- current compose file keeps service-name connectivity explicit for the `memorymesh` container

## Ollama Model Bootstrap and Preflight

MemoryMesh now protects embedding model availability in two layers:

1. Docker bootstrap (`ollama-model-init` in `docker-compose.yml`)
: waits for Ollama and pulls `EMBEDDING_MODEL` automatically (default `nomic-embed-text`).
2. Runtime preflight
: before real import/local embedding work, MemoryMesh verifies the configured model exists and fails early with a clear actionable error if missing.

If Ollama is reachable but model is missing, error guidance points to:
- `ollama pull <EMBEDDING_MODEL>`
- or Docker bootstrap (`docker compose up -d --build`)

Host vs Docker note:
- host-run CLI/server (`localhost:11434`) requires local Ollama model availability
- Docker Compose mode uses `ollama-model-init` to bootstrap model pull automatically

## Retrieval and Token Efficiency

MemoryMesh uses a hybrid retrieval architecture: Qdrant for semantic search,
MongoDB for full raw content, and Neo4j for relationships and temporal context.
Because MCP tool responses are injected into LLM context, large responses can
burn tokens quickly. MemoryMesh therefore defaults to preview-first retrieval for search flows
(
`search_memory` returns previews), while exact full retrieval remains
available through dedicated tools such as `get_memory` and
`get_memory_by_ref`.

This reduces token cost, keeps context cleaner for reasoning, and still
gives users explicit control when full artifacts are needed.

## Memory Access Modes

MemoryMesh supports configurable memory permissions so you can control read and
write behavior independently.

Mode changes affect MCP tool registration at server startup.
After changing `.env`, restart MemoryMesh server and reconnect MCP clients (for example Claude Desktop) to refresh visible tools.

### Default mode (Read + Write)

MemoryMesh will:
- search past memories
- save new memories

Configuration:

```bash
MEMORYMESH_MEMORY_READ_ENABLED=true
MEMORYMESH_MEMORY_WRITE_ENABLED=true
```

Best for:
- long running agents
- assistants that should learn over time

### Read-only memory mode

MemoryMesh will:
- search existing memories
- NOT write new memories
- expose only read tools to MCP clients (`search_memory`, `get_memory`, `get_memory_by_ref`, `get_related_memories`, `list_projects`)

Configuration:

```bash
MEMORYMESH_MEMORY_READ_ENABLED=true
MEMORYMESH_MEMORY_WRITE_ENABLED=false
```

Benefits:
- avoids token cost of embeddings
- allows curated memory datasets
- useful for imported GPT history

Example use case:

```bash
memorymesh import:gpt
```

Then run Claude using only retrieval.

### Write-only ingestion mode

MemoryMesh will:
- save memories
- NOT search them
- expose only write tools to MCP clients (`save_memory`, `get_memory_status`)

Configuration:

```bash
MEMORYMESH_MEMORY_READ_ENABLED=false
MEMORYMESH_MEMORY_WRITE_ENABLED=true
```

Useful for:
- ingestion pipelines
- batch memory creation

### Isolated session mode

MemoryMesh will:
- not read
- not write
- hide both read and write memory tools from MCP clients

Configuration:

```bash
MEMORYMESH_MEMORY_READ_ENABLED=false
MEMORYMESH_MEMORY_WRITE_ENABLED=false
```

Use cases:
- private conversations
- debugging agents
- temporary sessions

### Important note about imports

Import commands ignore memory permissions.

```bash
memorymesh import:gpt
```

This command will always save memories regardless of write setting.
Imports are administrative operations.

MCP mode controls tool visibility at registration time and also keeps runtime permission checks as a second safety layer.
Use `get_runtime_health` to inspect current mode, registered tool visibility, and backend store health.

### Recommended setups

Claude Desktop with GPT memory:

Read-only mode

```bash
MEMORYMESH_MEMORY_READ_ENABLED=true
MEMORYMESH_MEMORY_WRITE_ENABLED=false
```

This allows Claude to use your GPT history without generating new memory entries.

### Cost considerations

Saving memory requires:
- embedding generation
- vector database writes

Disabling write can significantly reduce token usage.

## Importer/Core Workstream Roadmap

Completed:
- Phase 1: shared core extraction for server and CLI boundaries
- Phase 2: GPT traversal and classification improvements
- Phase 3: CLI UX and pacing (progress, dry-run detail, delay controls)
- Phase 4: unit tests for core/importer/cli behaviors
- Phase 5: build/test/docker verification
- Phase 6A: roadmap and phase alignment

Planned next:
- Phase 6B: importer modularization
- Phase 6C: importer gateway expansion
- Phase 6D: importer identity and metadata (`conversation_id`, `ref_id`, source mapping)
- Phase 6E: idempotent import and dedup policy
- Phase 6F: repeated-import tests and regression coverage

Focus for the remaining phases:
- Keep importer parsing, mapping, and write orchestration reusable across clients.
- Expand gateway contracts without coupling core logic to transport details.
- Prevent duplicate memory writes during repeated imports.

## Import Policy Status

Current importer policy behavior:
- `skip_existing` (supported, default): skips records when the same `ref_id` already exists
- `import_anyway` (supported): bypasses dedup and imports duplicate records
- `overwrite_existing` (not implemented across all stores): currently returns skip reason `overwrite_existing_not_supported`

The current behavior is intentional until safe cross-store overwrite semantics are implemented.

## CLI Importer

MemoryMesh provides a GPT export importer CLI in `@memorymesh/cli`. It can scan a single
JSON file or a folder recursively, classify JSON shapes, and import only supported GPT
conversation files.

User-facing entrypoint:

```bash
memorymesh
```

Direct command mode:

```bash
memorymesh import:gpt --path <file-or-folder> [options]
```

Interactive mode defaults:
- project = `MemoryMesh`
- mode = `real import`
- engine = `rust`
- import policy = `skip_existing`

Set `MEMORYMESH_INTERACTIVE_DRY_RUN=true` to force interactive dry-run mode.

Default output is quiet for large runs:
- progress bar during execution
- final summary at the end

Use `--verbose` when you need detailed per-message `IMPORT/SKIP` dry-run logs.

Quick examples:

```bash
# interactive mode
memorymesh

# direct dry-run folder import (quiet default)
memorymesh import:gpt \
  --path /Users/gokay/Downloads/gpt-extraction \
  --project MemoryMesh \
  --dry-run

# rust engine dry-run
memorymesh import:gpt \
  --path /Users/gokay/Downloads/gpt-extraction \
  --project MemoryMesh \
  --dry-run \
  --engine rust
```

Development script path remains available:

```bash
npm run -w @memorymesh/cli import:gpt -- --path /path/to/export --dry-run
```

Full CLI documentation: [`packages/cli/README.md`](packages/cli/README.md)

### Import Audit Log

GPT import runs can write a structured JSON Lines audit log for post-run analysis.

- default behavior:
  - real import: enabled
  - dry-run: disabled
- output location (default): `~/.memorymesh/import-audit/`
- env controls:
  - `MEMORYMESH_IMPORT_AUDIT_ENABLED=true|false`
  - `MEMORYMESH_IMPORT_AUDIT_DIR=/custom/path`

The audit captures run/scan/file/conversation/message/checkpoint lifecycle events and final summary fields. This helps diagnose import coverage gaps, partial persistence, and checkpoint progression.

## License
MIT
