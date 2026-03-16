# MemoryMesh — Product Requirements Document
## Phase 1: Local MCP Server

**Version:** 0.1  
**Goal:** A fully local MCP memory server that runs with Claude Code and Claude Desktop, and can be started with `docker compose up`.

---

## Problem

Claude.ai and Claude Code do not remember technical project context across sessions. In each new conversation, users must manually paste codebase details, architecture decisions, and lessons from previous sessions. This causes both time loss and context window waste.

---

## Solution

MemoryMesh is a local memory server that Claude connects to as an MCP tool. During conversations, Claude can proactively:

- Write important information to MemoryMesh
- Query MemoryMesh when it is uncertain or missing context
- Organize everything by project namespace (e.g., the "HumanTick" project)

MemoryMesh has evolved from a single flat server project into a small local ecosystem:

- `apps/server`: MCP memory server
- `packages/core`: shared types and contracts
- `packages/cli`: import and utility tooling

---

## Phase 1 Scope

### In Scope
- Local MCP server (stdio transport)
- Claude Code and Claude Desktop integration
- Qdrant vector DB (Docker)
- Ollama embeddings (nomic-embed-text model)
- MongoDB document store for full raw content
- Neo4j graph store for tags, project links, and temporal/related lookups
- HTTP MCP transport for local connector-based usage
- npm workspaces monorepo structure
- CLI tooling for GPT conversation import
- In-process profiling for save/search latency measurement
- Project-based memory namespace
- One-command setup with `docker compose up`

### Out of Scope (Phase 2)
- Claude.ai web connector (public HTTPS endpoint)
- Cloudflare Tunnel integration
- Automatic codebase ingestion / file watcher
- Multi-user support
- UI dashboard

---

## Technical Architecture

```
Claude Code / Claude Desktop
└── MCP (stdio or HTTP transport)
    └── MemoryMesh Server (`apps/server`, TypeScript, MCP SDK)
        ├── Ollama API -> nomic-embed-text (embeddings)
        ├── Qdrant -> semantic vectors and metadata
        ├── MongoDB -> full raw content storage
        └── Neo4j -> graph relationships, tags, and temporal links

CLI / Import Tools (`packages/cli`)
└── MCP HTTP calls -> MemoryMesh Server

Shared Contracts (`packages/core`)
└── TypeScript types used across packages
```

### Current Technology Stack

- TypeScript
- npm workspaces monorepo
- MCP SDK
- Qdrant
- Ollama
- MongoDB
- Neo4j
- Docker Compose
- Jest + ts-jest
- ts-node
- Zod

### Docker Compose Services

```yaml
services:
  qdrant:
    image: qdrant/qdrant
    ports: ["6333:6333"]
    volumes: ["qdrant_storage:/qdrant/storage"]

  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes: ["ollama_models:/root/.ollama"]

  mongodb:
    image: mongo:7
    ports: ["27017:27017"]
    environment:
      - MONGO_INITDB_DATABASE=memorymesh
    volumes: ["mongodb_data:/data/db"]

  neo4j:
    image: neo4j:5
    ports: ["7474:7474", "7687:7687"]
    environment:
      - NEO4J_AUTH=none
    volumes: ["neo4j_data:/data"]

  memorymesh:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    depends_on: [qdrant, ollama, mongodb, neo4j]
    environment:
      - TRANSPORT=http
      - HTTP_PORT=3456
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OLLAMA_HOST=ollama
      - OLLAMA_PORT=11434
      - EMBEDDING_MODEL=nomic-embed-text
      - MONGO_HOST=mongodb
      - MONGO_PORT=27017
      - MONGO_DB=memorymesh
      - NEO4J_URI=bolt://neo4j:7687
```

---

## MCP Tool Definitions

MemoryMesh currently exposes 3 MCP tools:

### 1. `save_memory`
```
Description: Save important information, decisions, learnings, preferences, or outputs to memory.
Parameters:
  - content (string): Information to save
  - project (string): Project name (e.g., "HumanTick")
  - memory_type (enum): "decision" | "learning" | "context" | "preference" | "output"
  - tags (string[]): Optional inferred topic tags
  - title (string): Optional human-readable title
  - ref_id (string): Optional exact reference identifier
  - source_type (enum): "code_block" | "email" | "document" | "plan" | "summary"
Returns: {id, status}
```

### 2. `search_memory`
```
Description: Search relevant information in memory.
Parameters:
  - query (string): Search query
  - project (string): Project name (if empty, search all projects)
  - limit (int): Maximum result count (default: 5)
  - tags (string[]): Optional tag filters
  - ref_id (string): Optional exact ID lookup
  - title (string): Optional exact title filter
  - source_type (string): Optional source type filter
  - sort_by (enum): "relevance" | "recency" | "oldest"
  - before (string): Optional ISO timestamp upper bound
  - after (string): Optional ISO timestamp lower bound
Returns: [{content, full_content, project, memory_type, tags, title, ref_id, source_type, similarity_score, created_at}]
```

### 3. `list_projects`
```
Description: List projects stored in memory.
Parameters: none
Returns: [{project, memory_count, last_updated}]
```

---

## System Prompt for Claude (Project Instructions)

Users will add this to Claude Project Instructions:

```
You have access to a memory system called MemoryMesh.

WRITE RULE:
Use the save_memory tool when you encounter information such as:
- Architecture decisions ("We decided to use Y instead of X because...")
- Learnings ("This bug was caused by...")
- Project context ("HumanTick's authentication system works like this...")
- User preferences ("This project uses TypeScript strict mode")

READ RULE:
Use the search_memory tool in these cases:
- When your knowledge feels incomplete or uncertain about a topic
- When the user refers to something discussed before
- When you need project information that may exist in memory but was not mentioned in the current conversation

You decide what is important. Do not save everything; only save information that is likely to be useful in the future.
```

---

## File Structure

```
memorymesh/
├── apps/
│   └── server/
│       ├── Dockerfile
│       ├── package.json
│       ├── tsconfig.json
│       ├── scripts/
│       └── src/
├── packages/
│   ├── core/
│   │   └── src/
│   └── cli/
│       ├── scripts/
│       └── src/
├── docker-compose.yml
├── package.json
├── package-lock.json
├── .env.example
├── README.md
├── LICENSE
└── install.sh
```

---

## Claude Code Setup Steps (README)

```bash
# 1. Clone repository
git clone https://github.com/yourname/memorymesh
cd memorymesh

# 2. Install dependencies
npm install

# 3. Build all workspaces
npm run build

# 4. Start services
docker compose up -d

# 5. Pull Ollama model (once on first setup)
docker exec memorymesh-ollama-1 ollama pull nomic-embed-text

# 6. Add to Claude Code (stdio mode)
claude mcp add memorymesh -- node apps/server/dist/index.js
```

---

## Data Model (Qdrant Collection)

```
Collection: "memories"

Each memory point:
  vector: float[] (768 dim, nomic-embed-text)
  payload:
    - content: string
    - project: string
    - memory_type: string
    - created_at: ISO8601 timestamp
    - tags: string[]
    - title: string
    - ref_id: string
    - source_type: string
    - conversation_id: string (optional)
```

## Additional Storage Layers

### MongoDB

- Stores full raw content for `output` memories
- Indexed by the Qdrant point ID
- Used to return exact content, not just semantic payload summaries

### Neo4j

- Stores `Memory` and `Tag` graph nodes
- Adds `HAS_TAG` and `SAME_PROJECT` relationships
- Supports related-memory expansion and temporal/tag-based graph queries

## Runtime Behavior

- Save flow can return immediately with a pending ID while embedding and persistence continue in the background
- Search flow remains synchronous and waits for embeddings and query execution
- A profiler records `embed`, Qdrant, MongoDB, Neo4j, and sort timings during operations

---

## Success Criteria (Phase 1)

1. Services start successfully with `docker compose up`
2. Claude Code can discover and call the `save_memory` tool
3. A saved memory can be found semantically via `search_memory`
4. Different projects such as "HumanTick" and "ProjectX" are isolated
5. Memories persist after container restart via Qdrant volume

---

## Phase 2 Plan (Out of Scope but should be known)

- Cloudflare Tunnel integration into `docker compose up`
- Automatically show generated public URL to the user
- Claude.ai web -> Settings -> Connectors -> paste URL
- Codebase ingestion: file watcher + incremental indexing

---

## Dependencies

```json
{
  "dependencies": {
    "@memorymesh/core": "*",
    "@modelcontextprotocol/sdk": "latest",
    "@qdrant/js-client-rest": "latest",
    "mongodb": "latest",
    "neo4j-driver": "latest",
    "ollama": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/jest": "latest",
    "typescript": "latest",
    "@types/node": "latest",
    "jest": "latest",
    "ts-jest": "latest",
    "ts-node": "latest"
  }
}
```

---

## Notes

- First Ollama model pull requires internet connection (~270MB)
- Qdrant storage is kept in `./qdrant_storage` volume by default
- MongoDB and Neo4j are also part of the local stack
- HTTP transport is already available locally in addition to stdio
- No OpenAI API key is required; it runs fully local
- CLI tools communicate with the server over MCP HTTP rather than importing server internals directly
- The server lives in `apps/server`, while shared contracts live in `packages/core`
