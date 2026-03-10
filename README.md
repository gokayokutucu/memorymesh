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
Sen MemoryMesh adlı bir hafıza sistemine erişimin var.

YAZMA KURALI:
Konuşma sırasında aşağıdaki türde bilgilerle karşılaşırsan save_memory tool'unu kullan:
- Mimari kararlar ("X yerine Y kullanmaya karar verdik çünkü...")
- Öğrenilen şeyler ("Bu bug şundan kaynaklanıyordu...")
- Proje context'i ("HumanTick'in authentication sistemi şöyle çalışıyor...")
- Kullanıcı tercihleri ("Bu projede TypeScript strict mode kullanılıyor")

OKUMA KURALI:
Aşağıdaki durumlarda search_memory tool'unu kullan:
- Bir konuda bilgin eksik veya belirsiz hissediyorsan
- Kullanıcı daha önce konuşulmuş bir şeye atıfta bulunuyorsa
- Proje hakkında sana söylenmeyen ama hafızada olabilecek bir bilgiye ihtiyaç duyuyorsan

Hangi bilginin önemli olduğuna sen karar ver. Her şeyi kaydetme, sadece gelecekte işe yarayacak olanları kaydet.
```

## Verify It Works

After adding the MCP server, ask Claude:

```text
do you have any tools available?
```
