const mockGetCollections = jest.fn();
const mockCreateCollection = jest.fn();
const mockUpsert = jest.fn();
const mockSearch = jest.fn();
const mockScroll = jest.fn();
const mockRetrieve = jest.fn();

jest.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    createCollection: mockCreateCollection,
    upsert: mockUpsert,
    search: mockSearch,
    scroll: mockScroll,
    retrieve: mockRetrieve,
  })),
}));

describe("storage resilience", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      MEMORYMESH_RETRY_MAX_ATTEMPTS: "2",
      MEMORYMESH_RETRY_BASE_DELAY_MS: "0",
      MEMORYMESH_RETRY_MAX_DELAY_MS: "0",
      MEMORYMESH_RETRY_JITTER_MS: "0",
      EMBEDDING_MODEL: "nomic-embed-text",
      MEMORYMESH_EMBEDDING_MODE: "flash",
      MEMORYMESH_EMBEDDING_DIMENSION: "768",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("retries transient qdrant getCollections and then succeeds", async () => {
    mockGetCollections
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ collections: [{ name: "memories" }] });

    const storage = await import("../storage");
    await storage.ensureCollection();

    expect(mockGetCollections).toHaveBeenCalledTimes(2);
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it("does not retry permanent qdrant upsert errors", async () => {
    mockUpsert.mockRejectedValue(new Error("invalid vector length"));
    const storage = await import("../storage");

    await expect(
      storage.savePoint(
        [0.1],
        {
          content: "x",
          project: "p",
          memory_type: "context",
          created_at: new Date().toISOString(),
        }
      )
    ).rejects.toThrow("invalid vector length");

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("caches collection existence and avoids repeated getCollections calls", async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: "memories" }] });

    const storage = await import("../storage");
    await storage.ensureCollection();
    await storage.ensureCollection();

    expect(mockGetCollections).toHaveBeenCalledTimes(1);
  });

  it("creates collection with resolved embedding dimension", async () => {
    process.env.EMBEDDING_MODEL = "mxbai-embed-large";
    process.env.MEMORYMESH_EMBEDDING_MODE = "medium";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "1024";
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockResolvedValue({ status: "ok" });

    const storage = await import("../storage");
    await storage.ensureCollection();

    expect(mockCreateCollection).toHaveBeenCalledWith(
      "memories",
      expect.objectContaining({
        vectors: expect.objectContaining({ size: 1024 }),
      })
    );
  });

  it("revalidates collection cache when operation reports missing collection", async () => {
    mockSearch
      .mockRejectedValueOnce(new Error("collection does not exist"))
      .mockResolvedValueOnce([]);
    mockGetCollections.mockResolvedValue({ collections: [{ name: "memories" }] });

    const storage = await import("../storage");
    const results = await storage.searchPoints([0.1], { query: "test", limit: 1 });

    expect(results).toEqual([]);
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockGetCollections).toHaveBeenCalledTimes(1);
  });

  it("applies metadata-aware filters in qdrant search request", async () => {
    mockSearch.mockResolvedValue([]);

    const storage = await import("../storage");
    await storage.searchPoints([0.1], {
      query: "notes",
      project: "MemoryMesh",
      source_type: "document",
      filename: "notes.md",
      relative_path: "docs/notes.md",
      source_extension: "md",
    });

    const request = mockSearch.mock.calls[0][1] as {
      filter?: { must?: Array<{ key: string; match?: { value?: string } }> };
    };
    const keys = (request.filter?.must ?? []).map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining([
      "project",
      "source_type",
      "source_metadata.filename",
      "source_metadata.relative_path",
      "source_metadata.source_extension",
    ]));
  });

  it("maps source_metadata from qdrant payload into search results", async () => {
    const createdAt = new Date().toISOString();
    mockSearch.mockResolvedValue([
      {
        id: "doc-1",
        score: 0.9,
        payload: {
          content: "Document content",
          project: "MemoryMesh",
          memory_type: "context",
          created_at: createdAt,
          source_format: "document_import_v1",
          source_type: "document",
          ref_id: "import:document:abc",
          source_metadata: {
            filename: "notes.md",
            source_path: "/tmp/notes.md",
            relative_path: "docs/notes.md",
            source_extension: "md",
            chunk_index: 1,
            chunk_total: 3,
            project: "MemoryMesh",
            ref_id: "import:document:abc",
          },
        },
      },
    ]);

    const storage = await import("../storage");
    const results = await storage.searchPoints([0.1], { query: "notes", limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].source_metadata).toEqual(
      expect.objectContaining({
        filename: "notes.md",
        source_extension: "md",
        chunk_index: 1,
      })
    );
  });

  it("recreates collection with 1024 dimension after 768->1024 config migration", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";
    mockGetCollections.mockResolvedValueOnce({ collections: [{ name: "memories" }] });

    const storage = await import("../storage");
    await storage.ensureCollection();

    process.env.EMBEDDING_MODEL = "mxbai-embed-large";
    process.env.MEMORYMESH_EMBEDDING_MODE = "medium";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "1024";

    mockUpsert
      .mockRejectedValueOnce(new Error("collection does not exist"))
      .mockResolvedValueOnce({ status: "ok" });
    mockGetCollections.mockResolvedValueOnce({ collections: [] });
    mockCreateCollection.mockResolvedValueOnce({ status: "ok" });

    await storage.savePoint(
      [0.1],
      {
        content: "migrated",
        project: "p",
        memory_type: "context",
        created_at: new Date().toISOString(),
      },
      "point-1"
    );

    expect(mockCreateCollection).toHaveBeenCalledWith(
      "memories",
      expect.objectContaining({
        vectors: expect.objectContaining({ size: 1024 }),
      })
    );
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });
});
