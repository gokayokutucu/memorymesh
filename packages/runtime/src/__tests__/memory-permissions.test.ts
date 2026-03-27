import {
  IProjectSummary,
  ISearchMemoryInput,
  ISearchResult,
} from "@memorymesh/core";

const mockEmbed = jest.fn<Promise<number[]>, [string]>();
const mockEnsureCollection = jest.fn<Promise<void>, []>();
const mockOrchestrateSave = jest.fn<
  Promise<{ id: string; qdrant_saved: boolean; mongo_saved: boolean; neo4j_saved: boolean }>,
  [unknown, number[], unknown, string?]
>();

jest.mock("../embeddings", () => ({
  embed: (text: string) => mockEmbed(text),
}));

jest.mock("../storage", () => ({
  ensureCollection: () => mockEnsureCollection(),
  getPointsByIds: jest.fn<Promise<ISearchResult[]>, [string[]]>().mockResolvedValue([]),
  listProjects: jest.fn<Promise<IProjectSummary[]>, []>().mockResolvedValue([]),
  searchPoints: jest
    .fn<Promise<ISearchResult[]>, [number[], ISearchMemoryInput]>()
    .mockResolvedValue([]),
}));

jest.mock("../orchestrator", () => ({
  buildPreview: jest.fn((content: string) => content),
  orchestrateSave: (...args: [unknown, number[], unknown, string?]) =>
    mockOrchestrateSave(...args),
  orchestrateSearch: jest
    .fn<Promise<ISearchResult[]>, [number[], ISearchMemoryInput]>()
    .mockResolvedValue([]),
}));

jest.mock("../document-store", () => ({
  getDocuments: jest.fn().mockResolvedValue(new Map<string, string>()),
}));

jest.mock("../graph-store", () => ({
  getRelated: jest.fn().mockResolvedValue([]),
}));

describe("memory permissions", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.resetModules();
    mockEmbed.mockReset().mockResolvedValue(new Array(3).fill(0.1));
    mockEnsureCollection.mockReset().mockResolvedValue(undefined);
    mockOrchestrateSave.mockReset().mockResolvedValue({
      id: "save-1",
      qdrant_saved: true,
      mongo_saved: true,
      neo4j_saved: true,
    });
    delete process.env.MEMORYMESH_MEMORY_READ_ENABLED;
    delete process.env.MEMORYMESH_MEMORY_WRITE_ENABLED;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("WRITE=false disables saveMemory with deterministic skipped response", async () => {
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "false";
    const { saveMemory, getMemoryStatus } = await import("../memory");

    const result = saveMemory({
      content: "content",
      project: "MemoryMesh",
      memory_type: "context",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("memory_write_disabled");
    expect(mockEnsureCollection).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();

    const status = getMemoryStatus(result.id);
    expect(status?.status).toBe("skipped");
    expect(status?.reason).toBe("memory_write_disabled");
  });

  it("READ=false disables searchMemory and returns empty array", async () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "false";
    const { searchMemory } = await import("../memory");

    const results = await searchMemory({ query: "architecture" });

    expect(results).toEqual([]);
    expect(mockEnsureCollection).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it("saveMemoryForImport bypasses WRITE=false guard", async () => {
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "false";
    const { saveMemoryForImport } = await import("../memory");

    const result = saveMemoryForImport({
      content: "imported content",
      project: "MemoryMesh",
      memory_type: "output",
    });

    expect(result.status).toBe("pending");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockEnsureCollection).toHaveBeenCalledTimes(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockOrchestrateSave).toHaveBeenCalledTimes(1);
  });
});
