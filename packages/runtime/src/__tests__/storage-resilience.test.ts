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
});
