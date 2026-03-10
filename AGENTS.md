# MemoryMesh Agent Rules

This document defines the rules for all agent/Codex runs in the MemoryMesh repository.
Follows the Humantick Workspace Global Policy structure.

---

## 1) Preferred Prompt & Output Contract

- All implementation tasks MUST start with a single header line:
  `Output of TASK: <exact task name>`
- The response MUST then provide, in this exact order:
  1. Patch-like diff (edited files/sections only)
  2. If applicable: changed types/interfaces/tests (max 5 bullets)
  3. Git commands in a single fenced bash block
- No explanatory commentary outside the required structure.
- Do not duplicate task headers in the same response.
- Commit numbering MUST be strictly incremental: N1, N2, N3... (no repeats).

Formatting rules:
- Use fenced blocks for diffs and git commands.
- Do not include triple backticks inside diff blocks.
- Keep diffs minimal (edited sections only).

---

## 2) Branching Rules

- Base branch is `dev`.
- Create feature branches directly from `dev`. No sub-branches.
- Feature branch naming pattern: `feature/<phase>-<short-description>`
  - Examples: `feature/phase1-mcp-server`, `feature/phase1-qdrant-storage`
- If an open feature branch exists for the current workstream, warn before creating a new one and ask for confirmation.
- Do NOT delete branches unless they are merged.

---

## 3) Commit & Push Rules

- Never commit directly on `dev`.
- If changes are made while on `dev`, DO NOT commit automatically. Ask before committing.
- On feature branches, make small commits per sub-step and push after each commit.
- After each commit-worthy sub-step:
  - Run required tests (see Section 4)
  - Commit with message: `N<index>: <short summary>`
  - Push the branch

---

## 4) Testing Rules

- Before starting any development work:
  - Run `npm test` to verify baseline is green
- After each commit-worthy sub-step:
  - Run `npm test`
- All new tools and functions MUST have unit tests.
- Test file convention: `src/__tests__/<module>.test.ts`

---

## 5) TypeScript Style Rules

- Strict TypeScript: `"strict": true` in tsconfig.json
- No `any` types. Use explicit types or `unknown`.
- Prefer `interface` over `type` for object shapes.
- All MCP tool inputs and outputs MUST have explicit TypeScript interfaces defined in `src/types.ts`.
- Use `async/await`, never raw `.then()` chains.
- Error handling: always catch and return structured errors, never throw unhandled rejections.

---

## 6) Project Architecture Rules

### MCP Server (`src/index.ts`)
- Entry point only. Tool registration and server startup.
- No business logic in `index.ts`.

### Module boundaries
- `src/memory.ts` — save/search orchestration logic only
- `src/embeddings.ts` — Ollama client only
- `src/storage.ts` — Qdrant client only
- `src/types.ts` — all shared interfaces and enums

### Naming conventions
- Tool names: `snake_case` (MCP convention): `save_memory`, `search_memory`, `list_projects`
- Functions: `camelCase`
- Interfaces: `PascalCase` with `I` prefix: `IMemoryPayload`, `ISearchResult`
- Constants: `UPPER_SNAKE_CASE`

---

## 7) Docker & Environment Rules

- All external services (Qdrant, Ollama) run in Docker containers only.
- MCP server itself runs on the host via `node dist/index.js` (stdio transport, Faz 1).
- Environment variables MUST be read from `.env` file. Never hardcode hosts/ports.
- `.env.example` MUST always be kept up to date with all required variables.
- Required env vars:
  ```
  QDRANT_HOST=localhost
  QDRANT_PORT=6333
  OLLAMA_HOST=localhost
  OLLAMA_PORT=11434
  EMBEDDING_MODEL=nomic-embed-text
  QDRANT_COLLECTION=memories
  ```

---

## 8) Strict Guards

STRICT GUARDS (must follow, otherwise STOP and report):

0. Print scope before doing anything:
   ```bash
   git status --short
   git diff --name-only
   git diff --staged --name-only
   ```

1. No new untracked files allowed before commit:
   ```bash
   git ls-files --others --exclude-standard
   ```
   MUST be empty (excluding `.env` which is gitignored). If not empty, clean up first.

2. Commit scope hygiene:
   - Before commit, print staged file list:
     ```bash
     git diff --staged --name-only
     ```
   - Commit message MUST match staged files' scope.
   - Do NOT mention modules/files not staged.

3. Build gating — if `src/` is changed:
   ```bash
   npm run build
   npm test
   ```
   Do NOT commit if build or tests fail.

4. Push rule:
   - Normal commits: `git push`
   - History rewrite: `git push --force-with-lease`

---

## 9) PRD Reference

Full product spec lives in `PRD.md` at the repo root.
All implementation decisions MUST align with the PRD.
If a task requires deviating from the PRD, stop and ask before proceeding.

Phase scope for this repo:
- **Faz 1 (current):** Local MCP server, stdio transport, Qdrant + Ollama via Docker
- **Faz 2 (future):** Remote MCP server, HTTP transport, Cloudflare Tunnel, Claude.ai web connector