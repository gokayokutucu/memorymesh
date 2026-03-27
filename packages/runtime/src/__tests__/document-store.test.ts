const mockCreateIndex = jest.fn();
const mockUpdateOne = jest.fn();
const mockFindOne = jest.fn();
const mockToArray = jest.fn();
const mockFind = jest.fn();
const mockCollection = jest.fn();
const mockDb = jest.fn();
const mockConnect = jest.fn();

jest.mock("mongodb", () => ({
  MongoClient: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    db: mockDb,
  })),
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.MONGO_USER = "mongo-user";
  process.env.MONGO_PASSWORD = "mongo-password";
  mockCreateIndex.mockResolvedValue("documents__id");
  mockUpdateOne.mockResolvedValue(undefined);
  mockFindOne.mockResolvedValue(null);
  mockToArray.mockResolvedValue([]);
  mockFind.mockReturnValue({ toArray: mockToArray });
  mockCollection.mockReturnValue({
    createIndex: mockCreateIndex,
    updateOne: mockUpdateOne,
    findOne: mockFindOne,
    find: mockFind,
  });
  mockDb.mockReturnValue({ collection: mockCollection });
  mockConnect.mockResolvedValue(undefined);
});

describe("document-store", () => {
  it("saveDocument writes/upserts a document", async () => {
    const { saveDocument } = await import("../document-store");

    await saveDocument("id-1", "full text", {
      project: "HumanTick",
      source_format: "document_import_v1",
      source_type: "document",
      source_metadata: {
        filename: "notes.md",
        source_path: "/tmp/notes.md",
        relative_path: "docs/notes.md",
        source_extension: "md",
        chunk_index: 1,
        chunk_total: 2,
      },
    });

    expect(mockCreateIndex).toHaveBeenCalledWith({ _id: 1 });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "id-1" },
      {
        $set: expect.objectContaining({
          content: "full text",
          metadata: expect.objectContaining({
            project: "HumanTick",
            source_format: "document_import_v1",
            source_type: "document",
            source_metadata: expect.objectContaining({
              filename: "notes.md",
              source_extension: "md",
            }),
          }),
        }),
      },
      { upsert: true }
    );
  });

  it("getDocument returns content when document exists", async () => {
    mockFindOne.mockResolvedValue({ _id: "id-1", content: "stored content" });
    const { getDocument } = await import("../document-store");

    const content = await getDocument("id-1");

    expect(content).toBe("stored content");
  });

  it("getDocuments returns a map keyed by id", async () => {
    mockToArray.mockResolvedValue([
      { _id: "1", content: "doc-1" },
      { _id: "2", content: "doc-2" },
    ]);
    const { getDocuments } = await import("../document-store");

    const docs = await getDocuments(["1", "2"]);

    expect(mockFind).toHaveBeenCalledWith(
      { _id: { $in: ["1", "2"] } },
      { projection: { content: 1 } }
    );
    expect(docs.get("1")).toBe("doc-1");
    expect(docs.get("2")).toBe("doc-2");
  });

  it("retries transient mongo updateOne failure and then succeeds", async () => {
    process.env.MEMORYMESH_RETRY_MAX_ATTEMPTS = "2";
    process.env.MEMORYMESH_RETRY_BASE_DELAY_MS = "0";
    process.env.MEMORYMESH_RETRY_MAX_DELAY_MS = "0";
    process.env.MEMORYMESH_RETRY_JITTER_MS = "0";
    mockUpdateOne
      .mockRejectedValueOnce(
        Object.assign(new Error("server selection timeout"), {
          name: "MongoServerSelectionError",
        })
      )
      .mockResolvedValueOnce(undefined);
    const { saveDocument } = await import("../document-store");

    const saved = await saveDocument("id-2", "content", { project: "HumanTick" });

    expect(saved).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledTimes(2);
  });
});
