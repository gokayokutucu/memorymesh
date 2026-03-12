# MemoryMesh

Local-first persistent memory ecosystem for AI assistants.

## Packages

| Package | Description |
|---------|-------------|
| `apps/server` | MCP memory server (Qdrant + MongoDB + Neo4j + Ollama) |
| `packages/core` | Shared types and utilities |
| `packages/cli` | Import tools (GPT export, etc.) |

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/gokayokutucu/memorymesh/main/install.sh | sh
```

Requirements: Docker Desktop, Node.js 18+

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

## License
MIT
