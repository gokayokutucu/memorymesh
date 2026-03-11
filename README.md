# MemoryMesh

MemoryMesh is a local-first MCP memory server for Claude Code and Claude Desktop that stores important project context, decisions, and learnings as semantic memories. It uses Ollama to generate embeddings and Qdrant to store and retrieve memories, so Claude can save high-value context during conversations and recall it later by relevance, scoped per project.

## Prerequisites

- Docker Desktop
- Node.js 18+
- npm

## Installation

```bash
# 1) Clone
git clone git@github.com:gokayokutucu/memorymesh.git
cd memorymesh

# 2) Install dependencies
npm install

# 3) Build
npm run build

# 4) Start services
docker compose up -d

# 5) Pull embedding model (first time only)
docker exec memorymesh-ollama-1 ollama pull nomic-embed-text
```

## Claude Code MCP Setup

```bash
claude mcp add memorymesh -- node /absolute/path/to/dist/index.js
```

Example:

```bash
claude mcp add memorymesh -- node /Users/gokay/Documents/Workspace/MemoryMesh/dist/index.js
```

## Project Instructions Prompt (Paste Into Claude)

```text
You have access to a memory system called MemoryMesh.

WRITE RULE:
Use the `save_memory` tool when you encounter information like:
- Architecture decisions ("We chose X instead of Y because...")
- Learnings ("This bug was caused by...")
- Project context ("HumanTick's authentication system works like this...")
- User preferences ("This project uses TypeScript strict mode")

READ RULE:
Use the `search_memory` tool in these cases:
- When your knowledge is missing or uncertain on a topic
- When the user references something discussed before
- When you need project information that might exist in memory but was not mentioned in the current chat

You decide what is important. Do not save everything; only save information that is likely to be useful in the future.
```

## Claude.ai Memory Slots — MemoryMesh Instructions

Paste these into your Claude.ai memory slots (Settings → Memory).

### Compact (1 slot)

```text
If MemoryMesh MCP tools are available, use save_memory during the conversation. Format: [INPUT] user request / [OUTPUT] response or result. Save when: a decision is made, something is learned or debugged, a preference/workflow is clarified, an important output is produced (code, email, document, plan), or the user says "remember this". Use search_memory before answering if relevant past context may exist, when a new chat starts with missing context, or when the user references earlier discussions. Save any meaningful content.
```

### Full (2 slots — recommended)

**Slot 1 — save_memory**

```text
If MemoryMesh tools are available, use save_memory when: a decision is made (technical, personal, or workflow-related), something is learned or a bug is debugged, a preference or working style is clarified, or an important output is produced (code, email, document, plan, summary). Also save when the user says "remember this". Format every entry as: [INPUT] the user's request or question / [OUTPUT] the response, result, or artifact produced. No topic restriction.
```

**Slot 2 — search_memory**

```text
If MemoryMesh tools are available, use search_memory proactively before generating a response if the topic might have relevant past context. Always search when: a new conversation starts and context feels missing, the user references something from a previous session ("last time", "we decided", "remember when"), or the current topic overlaps with decisions or outputs that may have been saved before. Trust the results — if a memory is retrieved, factor it into your answer.
```

## Verify It Works

After adding the MCP server, ask Claude:

```text
do you have any tools available?
```
