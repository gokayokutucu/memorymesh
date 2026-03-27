# MemoryMesh Roadmap

## Current Architecture

MemoryMesh is a local-first, Docker-based persistent memory layer built on MCP (Model Context Protocol), using **Qdrant** (vector search), **Neo4j** (graph relationships), and **MongoDB** (document storage) to extend Claude's memory across conversations.

- Repo: `git@github.com:gokayokutucu/memorymesh.git`
- Active branch: `feature/phase1-full-bootstrap`

---

## Phase 1 — Full Bootstrap *(Active)*

- [ ] Docker Compose setup for Qdrant + Neo4j + MongoDB
- [ ] MCP server exposing `search_memory` and `save_memory` tools
- [ ] Basic conversation ingestion pipeline (`extract_chatgpt_v2.py`)
- [ ] Initial embedding and indexing of 1,243 ChatGPT conversation exports

---

## Phase 2 — Core Memory Operations

- [ ] Semantic search via Qdrant (vector similarity)
- [ ] Entity and relationship graph via Neo4j
- [ ] Memory CRUD with idempotent upsert semantics
- [ ] Metadata tagging: source, timestamp, topic, importance score

---

## Phase 3 — Claude Agent SDK Integration

### Motivation

The [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) (formerly Claude Code SDK) provides a programmable agent loop with built-in tools, context compaction, and multi-session orchestration. MemoryMesh can serve as the persistent memory backend for agents built on this SDK, solving the long-running agent memory problem in a model-aware way.

### Design Principle

MemoryMesh remains **model-agnostic and local-first** as an MCP server. The Agent SDK is not a replacement — it is an execution layer that consumes MemoryMesh through the standard MCP protocol.

```
┌────────────────────────────────────────────┐
│            Claude Agent SDK Harness        │
│                                            │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Initializer     │  │ Coding / Task   │  │
│  │ Agent Session   │  │ Agent Sessions  │  │
│  └────────┬────────┘  └────────┬────────┘  │
│           │   MCP tool calls   │           │
└───────────┼────────────────────┼───────────┘
            ▼                    ▼
   ┌─────────────────────────────────────┐
   │         MemoryMesh MCP Server       │
   │   search_memory  |  save_memory     │
   ├──────────────┬──────────┬───────────┤
   │   Qdrant     │  Neo4j   │  MongoDB  │
   │  (vectors)   │ (graph)  │  (docs)   │
   └──────────────┴──────────┴───────────┘
```

### Deliverables

- [ ] **Session Bootstrap Tool** — On agent startup, call `search_memory` to hydrate context from previous sessions (replaces `claude-progress.txt` pattern with graph-backed recovery)
- [ ] **Session Snapshot Tool** — On agent shutdown, call `save_memory` with a structured summary of what was done, what files changed, and what remains
- [ ] **In-process MCP option** — Expose MemoryMesh tools as an in-process MCP server using `ClaudeSDKClient` + `@tool` decorator (eliminates separate process overhead for local dev)
- [ ] **Initializer / Coding Agent harness** — Two-prompt pattern: initializer sets up environment and writes initial memory nodes; subsequent agents read graph state and make incremental progress
- [ ] **Progress graph nodes** — Neo4j schema for session checkpoints: `(:Session)-[:FOLLOWED_BY]->(:Session)`, with task/file/decision nodes attached

### What We Do NOT Do

- Do not replace MemoryMesh's MCP interface with SDK-specific APIs
- Do not create Claude-only lock-in; other models can still connect via MCP
- Do not use `claude-progress.txt` flat files — Neo4j graph is the source of truth

---

## Phase 4 — Multi-Agent & Observability

- [ ] Multi-agent memory isolation (per-agent namespaces in Neo4j)
- [ ] Memory importance decay and pruning strategy
- [ ] Grafana/Loki integration for memory access observability
- [ ] REST API for external memory inspection and editing

---

## Phase 5 — Open Standard Alignment

- [ ] Align MemoryMesh MCP schema with emerging memory interoperability standards
- [ ] Publish MemoryMesh as a reusable, open-source memory backend for any MCP-compatible agent runtime
- [ ] Evaluate Agent Skills standard (`agentskills.io`) for skill-level memory scoping

---

## Notes

- Claude Agent SDK docs: https://platform.claude.com/docs/en/agent-sdk/overview
- Agent Skills standard: https://agentskills.io
- MCP spec: https://modelcontextprotocol.io