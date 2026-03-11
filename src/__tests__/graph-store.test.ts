const mockRun = jest.fn();
const mockClose = jest.fn();
const mockSession = jest.fn(() => ({
  run: mockRun,
  close: mockClose,
}));
const mockVerifyConnectivity = jest.fn();
const mockDriver = {
  session: mockSession,
  verifyConnectivity: mockVerifyConnectivity,
};
const mockDriverFactory = jest.fn(() => mockDriver);
const mockAuthBasic = jest.fn(() => ({}));
const mockNeo4jInt = jest.fn((value: number) => value);

jest.mock("neo4j-driver", () => ({
  __esModule: true,
  default: {
    driver: mockDriverFactory,
    int: mockNeo4jInt,
    auth: {
      basic: mockAuthBasic,
    },
  },
}));

describe("graph-store query functions", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockVerifyConnectivity.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  it("queryByTags returns matching memory IDs", async () => {
    mockRun.mockResolvedValue({
      records: [
        { get: (key: string) => (key === "id" ? "m-1" : "2026-03-10T00:00:00Z") },
        { get: (key: string) => (key === "id" ? "m-2" : "2026-03-09T00:00:00Z") },
      ],
    });
    const graphStore = await import("../graph-store");

    const ids = await graphStore.queryByTags(["auth", "jwt"], 5);

    expect(ids).toEqual(["m-1", "m-2"]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (m:Memory)-[:HAS_TAG]->(t:Tag)"),
      expect.objectContaining({ tags: ["auth", "jwt"] })
    );
  });

  it("queryByDateRange applies after/before/project parameters", async () => {
    mockRun.mockResolvedValue({
      records: [{ get: () => "m-3" }],
    });
    const graphStore = await import("../graph-store");

    const ids = await graphStore.queryByDateRange(
      "2026-03-01T00:00:00Z",
      "2026-03-11T00:00:00Z",
      "MemoryMesh",
      10
    );

    expect(ids).toEqual(["m-3"]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("m.created_at >= datetime($after)"),
      expect.objectContaining({
        after: "2026-03-01T00:00:00Z",
        before: "2026-03-11T00:00:00Z",
        project: "MemoryMesh",
      })
    );
  });

  it("queryRelated queries related nodes and excludes source ids in cypher", async () => {
    mockRun.mockResolvedValue({
      records: [{ get: () => "m-related" }],
    });
    const graphStore = await import("../graph-store");

    const ids = await graphStore.queryRelated(["m-1", "m-2"], 8);

    expect(ids).toEqual(["m-related"]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("NOT related.id IN $ids"),
      expect.objectContaining({ ids: ["m-1", "m-2"] })
    );
  });
});
