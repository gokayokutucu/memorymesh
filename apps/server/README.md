> ⚠️ memorymesh-tools (packages/cli) must be installed and running.
> See root README.md for setup instructions.

# MemoryMesh Server

MCP memory server backed by Qdrant, MongoDB, Neo4j, and Ollama.

## Docker Compose Env Loading

For Docker Compose runs, `.env` is the primary runtime config source.

`memorymesh` service uses:

```yaml
env_file:
  - .env
```

This ensures `MEMORYMESH_*` settings are loaded into the container without manually duplicating each variable.

Apply config changes with:

```bash
docker compose up -d --build
```

Then reconnect MCP clients (for example Claude Desktop) to refresh tool availability.

Connectivity note:
- Docker Compose mode uses container service names (`qdrant`, `mongodb`, `neo4j`, `ollama`)
- host-run mode uses `localhost`
- compose keeps container-to-container connectivity explicit in `memorymesh.environment`

## Ollama Model Bootstrap and Runtime Preflight

Compose startup now includes `ollama-model-init`, which waits for Ollama and pulls `EMBEDDING_MODEL` (default `nomic-embed-text`).
This protects first-run environments where Ollama is reachable but model weights are not yet present.

Runtime embedding path also performs a preflight model-existence check and fails early with an explicit error when the model is missing.
This avoids long import runs producing repeated background failures.

Host-run note:
- when running outside compose, ensure the model exists locally (for example `ollama pull nomic-embed-text`).

## Development

```bash
npm install
npm run build
npm test
```

## Run

```bash
node dist/index.js
```

## Retrieval Strategy, Token Efficiency, and Cost Control

Tool output becomes part of the LLM context window. Long tool responses
consume tokens, and large code/document memories can become expensive when
returned directly. MemoryMesh uses a preview-first strategy in search flows to
reduce unnecessary token usage while preserving retrieval quality.

This design protects both token budget and context window quality when MemoryMesh is used through LLM tools.

## Preview-First Pattern

Intended flow:

Typical retrieval flow:

```text
search_memory → preview results
           ↓
   model evaluates relevance
           ↓
     get_memory(id)
           ↓
      full content
```

1. Use `search_memory` to discover candidate memories by semantic/hybrid signal.
2. Review compact previews.
3. Use exact retrieval tools only for the items that matter.

Behavior by default (`MEMORYMESH_RETRIEVAL_MODE=preview`):

- `search_memory` returns compact previews.
- `get_memory` and `get_memory_by_ref` return full raw content when available.

This separation is deliberate and cost-aware.

## Direct Full Retrieval

You can skip preview discovery when you already know the exact memory id or
reference id:

- `get_memory` for internal id lookup
- `get_memory_by_ref` for external/task ids (e.g. `MM-012`, `TASK-001`)

This is useful for:

- code generation workflows
- artifact reconstruction
- export/recovery workflows
- premium/unlimited token environments

## Storage Architecture

- Qdrant: semantic vectors + searchable metadata
- MongoDB: full raw content (code blocks, docs, long artifacts)
- Neo4j: structural relationships, tags, temporal/context linkage

Large outputs are not embedded in full; semantic vectors are used for search
and MongoDB is used for exact full-text retrieval.

This separation allows MemoryMesh to avoid embedding extremely large documents while still enabling precise full retrieval when needed.

## Recommended LLM Usage Patterns

Search-first pattern:

```text
1) search_memory(query="auth token flow", project="MemoryMesh")
2) choose the relevant candidate id
3) get_memory(id="<chosen-id>")
```

Direct exact retrieval pattern:

```text
get_memory_by_ref(ref_id="MM-042")
```

## When Should You Use Preview vs Full Retrieval?

MemoryMesh supports both preview-based discovery and direct full retrieval. Choosing the right pattern helps balance **token cost**, **latency**, and **LLM reasoning quality**.

Use **preview-first retrieval** (recommended default) when:

- exploring or searching for relevant memories
- working with unknown or large documents
- minimizing token consumption in LLM workflows
- running agents that may perform multiple searches

Typical flow:

```text
search_memory → preview results
           ↓
   evaluate relevance
           ↓
      get_memory(id)
```

Use **direct full retrieval** when:

- you already know the exact memory id
- reconstructing stored artifacts (code, docs, outputs)
- exporting or restoring previously stored content
- working in environments where token cost is not a concern

Typical flow:

```text
get_memory(id="...")
```

or

```text
get_memory_by_ref(ref_id="MM-042")
```

If your workflow frequently requires full artifacts, you may prefer configuring:

```
MEMORYMESH_RETRIEVAL_MODE=full
```

For most LLM integrations, however, **preview-first retrieval provides the best balance between cost efficiency and retrieval quality**.

## Warnings and Best Practices

- Returning large raw content directly increases token usage.
- Preview-first is the default because it protects cost and context quality.
- You can choose a more convenience-oriented retrieval mode when desired.
- Search results intentionally avoid returning full MongoDB content unless explicitly requested via exact retrieval tools.

## Retrieval Configuration

Retrieval behavior is configurable via environment variables:

- `MEMORYMESH_RETRIEVAL_MODE`:
  - `preview` (default): always return preview-style search output
  - `full`: search may return full content directly when available
  - `adaptive`: return full content when memory content size is below `MEMORYMESH_ADAPTIVE_THRESHOLD`, otherwise return preview.
- `MEMORYMESH_PREVIEW_MAX_CHARS` (default `500`)
- `MEMORYMESH_PREVIEW_MAX_LINES` (default `12`)
- `MEMORYMESH_ADAPTIVE_THRESHOLD` (default `800`, used in `adaptive`)
- `MEMORYMESH_MAX_SAVE_PAYLOAD_BYTES` (default `262144`, blocks oversized `save_memory` payloads with `payload_too_large`)
- `MEMORYMESH_ENABLE_PROFILER_LOGS` (default `false`, enables runtime timing diagnostics like `[profiler] ...` when set to `true`)
- `MEMORYMESH_RETRY_MAX_ATTEMPTS` (default `3`, shared retry attempts for transient Qdrant/Mongo/Neo4j failures)
- `MEMORYMESH_RETRY_BASE_DELAY_MS` (default `150`)
- `MEMORYMESH_RETRY_MAX_DELAY_MS` (default `1500`)
- `MEMORYMESH_RETRY_JITTER_MS` (default `50`)
- `MEMORYMESH_CIRCUIT_BREAKER_FAILURE_THRESHOLD` (default `3`)
- `MEMORYMESH_CIRCUIT_BREAKER_OPEN_MS` (default `10000`)
- `MEMORYMESH_EMBED_CHUNK_MAX_CHARS` (default `3500`, splits long content into chunks for embedding and mean-pools chunk vectors into one final vector)
- `MEMORYMESH_EMBED_MAX_CONCURRENCY` (default `2`, bounded concurrent chunk embedding calls)
- `MEMORYMESH_MEMORY_READ_ENABLED` (default `true`, when `false` `search_memory` returns `{"results":[]}` and skips search)
- `MEMORYMESH_MEMORY_WRITE_ENABLED` (default `true`, when `false` `save_memory` returns `{"status":"skipped","reason":"memory_write_disabled"}`)

MCP tool registration now follows memory mode at startup:
- read enabled: `search_memory`, `get_memory`, `get_memory_by_ref`, `get_related_memories`, `list_projects`
- write enabled: `save_memory`, `get_memory_status`
- read-only mode hides write tools from MCP clients
- write-only mode hides read tools from MCP clients
- isolated mode hides both tool groups
- `get_runtime_health` is always available for diagnostics

Important:
- restart the server after `.env` mode changes
- reconnect MCP clients (Claude Desktop may cache tool availability until reconnect)
- operational Claude/Desktop mode guidance lives in [`packages/cli/README.md`](../../packages/cli/README.md)

Importer note:
- GPT import is an administrative path and bypasses `MEMORYMESH_MEMORY_WRITE_ENABLED` so imports can still write memory.

Example:

```bash
MEMORYMESH_RETRIEVAL_MODE=adaptive
MEMORYMESH_PREVIEW_MAX_CHARS=700
MEMORYMESH_PREVIEW_MAX_LINES=14
MEMORYMESH_ADAPTIVE_THRESHOLD=1200
```

## Note

MemoryMesh supports optional conversation/session identifiers when provided
by the calling client or agent framework.

However, environments such as Claude Desktop do not expose a stable
conversation identifier to MCP servers. In those cases MemoryMesh operates
without conversation scoping.
