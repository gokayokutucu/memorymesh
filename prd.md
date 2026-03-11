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

---

## Phase 1 Scope

### In Scope
- Local MCP server (stdio transport)
- Claude Code and Claude Desktop integration
- Qdrant vector DB (Docker)
- Ollama embeddings (nomic-embed-text model)
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
└── MCP (stdio transport)
    └── MemoryMesh MCP Server (TypeScript, MCP SDK)
        ├── Ollama API -> nomic-embed-text (embeddings)
        └── Qdrant (vector storage, Docker container)
```

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

  memorymesh:
    build: .
    depends_on: [qdrant, ollama]
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OLLAMA_HOST=ollama
      - OLLAMA_PORT=11434
      - EMBEDDING_MODEL=nomic-embed-text
```

---

## MCP Tool Definitions

MemoryMesh exposes 3 tools:

### 1. `save_memory`
```
Description: Save important information, decisions, or learnings to memory.
Parameters:
  - content (string): Information to save
  - project (string): Project name (e.g., "HumanTick")
  - memory_type (enum): "decision" | "learning" | "context" | "preference"
Returns: memory_id
```

### 2. `search_memory`
```
Description: Search relevant information in memory.
Parameters:
  - query (string): Search query
  - project (string): Project name (if empty, search all projects)
  - limit (int): Maximum result count (default: 5)
Returns: [{content, project, memory_type, similarity_score, created_at}]
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
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts           # MCP server entry point, tool definitions
    ├── memory.ts          # save/search logic
    ├── embeddings.ts      # Ollama embedding client
    └── storage.ts         # Qdrant client wrapper
```

---

## Claude Code Setup Steps (README)

```bash
# 1. Clone repository
git clone https://github.com/yourname/memorymesh
cd memorymesh

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Start services
docker compose up -d

# 5. Pull Ollama model (once on first setup)
docker exec memorymesh-ollama-1 ollama pull nomic-embed-text

# 6. Add to Claude Code
claude mcp add memorymesh -- node dist/index.js
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
    - conversation_id: string (optional)
```

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
    "@modelcontextprotocol/sdk": "latest",
    "@qdrant/js-client-rest": "latest",
    "ollama": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/node": "latest"
  }
}
```

---

## Notes

- First Ollama model pull requires internet connection (~270MB)
- Qdrant storage is kept in `./qdrant_storage` volume by default
- MCP transport is stdio in Phase 1 and planned to move to HTTP in Phase 2
- No OpenAI API key is required; it runs fully local
- MCP server runs with `node dist/index.js`, while Qdrant and Ollama run in separate Docker containers
