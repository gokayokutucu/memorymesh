# MemoryMesh — Product Requirements Document
## Faz 1: Local MCP Server

**Versiyon:** 0.1  
**Hedef:** Claude Code ve Claude Desktop üzerinde çalışan, tamamen local, `docker compose up` ile ayağa kalkan bir MCP memory server.

---

## Problem

Claude.ai ve Claude Code, session'lar arasında teknik proje context'ini hatırlamıyor. Kullanıcı her yeni conversation'da codebase bilgisini, mimari kararları ve geçmiş session öğrenmelerini manuel olarak paste etmek zorunda kalıyor. Bu hem zaman kaybı hem de context window israfı.

---

## Çözüm

MemoryMesh, Claude'un MCP tool olarak bağlandığı bir local memory server'dır. Claude konuşma sırasında kendi inisiyatifiyle:

- Önemli gördüğü bilgileri MemoryMesh'e yazar
- Bilmediği veya eksik hissettiği durumlarda MemoryMesh'e sorar
- Her şeyi project bazlı organize eder (örn. "HumanTick" projesi)

---

## Faz 1 Kapsamı

### Kapsam İÇİ
- Local MCP server (stdio transport)
- Claude Code ve Claude Desktop entegrasyonu
- Qdrant vector DB (Docker)
- Ollama embedding (nomic-embed-text modeli)
- Project bazlı memory namespace'i
- `docker compose up` ile tek komut kurulum

### Kapsam DIŞI (Faz 2)
- Claude.ai web connector (public HTTPS endpoint)
- Cloudflare Tunnel entegrasyonu
- Codebase otomatik ingestion / file watcher
- Multi-user desteği
- UI dashboard

---

## Teknik Mimari

```
Claude Code / Claude Desktop
└── MCP (stdio transport)
    └── MemoryMesh MCP Server (TypeScript, MCP SDK)
        ├── Ollama API → nomic-embed-text (embedding)
        └── Qdrant (vector storage, Docker container)
```

### Docker Compose Servisleri

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

## MCP Tool Tanımları

MemoryMesh 3 tool expose eder:

### 1. `save_memory`
```
Açıklama: Önemli bir bilgiyi, kararı veya öğrenmeyi hafızaya kaydet.
Parametreler:
  - content (string): Kaydedilecek bilgi
  - project (string): Proje adı (örn. "HumanTick")
  - memory_type (enum): "decision" | "learning" | "context" | "preference"
Döndürür: memory_id
```

### 2. `search_memory`
```
Açıklama: Hafızada alakalı bilgi ara.
Parametreler:
  - query (string): Arama sorgusu
  - project (string): Proje adı (boş bırakılırsa tüm projeler)
  - limit (int): Maksimum sonuç sayısı (default: 5)
Döndürür: [{content, project, memory_type, similarity_score, created_at}]
```

### 3. `list_projects`
```
Açıklama: Hafızada kayıtlı projeleri listele.
Parametreler: yok
Döndürür: [{project, memory_count, last_updated}]
```

---

## Claude İçin System Prompt (Project Instructions)

Kullanıcı Claude'un Project Instructions'ına şunu ekleyecek:

```
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

---

## Dosya Yapısı

```
memorymesh/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts           # MCP server entry point, tool tanımları
    ├── memory.ts          # save/search logic
    ├── embeddings.ts      # Ollama embedding client
    └── storage.ts         # Qdrant client wrapper
```

---

## Claude Code Kurulum Adımları (README)

```bash
# 1. Repo'yu clone et
git clone https://github.com/yourname/memorymesh
cd memorymesh

# 2. Bağımlılıkları yükle
npm install

# 3. Build et
npm run build

# 4. Servisleri başlat
docker compose up -d

# 5. Ollama modeli indir (ilk kurulumda bir kez)
docker exec memorymesh-ollama-1 ollama pull nomic-embed-text

# 6. Claude Code'a ekle
claude mcp add memorymesh -- node dist/index.js
```

---

## Veri Modeli (Qdrant Collection)

```
Collection: "memories"

Her memory point:
  vector: float[] (768 dim, nomic-embed-text)
  payload:
    - content: string
    - project: string
    - memory_type: string
    - created_at: ISO8601 timestamp
    - conversation_id: string (opsiyonel)
```

---

## Başarı Kriterleri (Faz 1)

1. `docker compose up` ile servisler hatasız ayağa kalkıyor
2. Claude Code, `save_memory` tool'unu görebiliyor ve çağırabiliyor
3. Kaydedilen bir memory, `search_memory` ile semantic olarak bulunabiliyor
4. "HumanTick" ve "ProjeX" gibi farklı projeler birbirinden izole çalışıyor
5. Qdrant volume ile memory'ler container restart'tan sonra kaybolmuyor

---

## Faz 2 Planı (Kapsam Dışı Ama Bilinmeli)

- `docker compose up` içine Cloudflare Tunnel entegrasyonu
- Oluşan public URL'i kullanıcıya otomatik göster
- Claude.ai web → Settings → Connectors → URL yapıştır
- Codebase ingestion: file watcher + incremental indexing

---

## Bağımlılıklar

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

## Notlar

- Ollama'nın ilk model pull'u internet bağlantısı gerektiriyor (~270MB)
- Qdrant storage varsayılan olarak `./qdrant_storage` volume'unda tutuluyor
- MCP transport Faz 1'de stdio, Faz 2'de HTTP'ye geçecek
- OpenAI API key gerektirmiyor, tamamen local çalışıyor
- MCP server `node dist/index.js` ile çalışıyor, Qdrant ve Ollama ayrı Docker container'larında