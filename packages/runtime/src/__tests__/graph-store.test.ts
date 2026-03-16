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
    process.env.MEMORYMESH_RETRY_MAX_ATTEMPTS = "2";
    process.env.MEMORYMESH_RETRY_BASE_DELAY_MS = "0";
    process.env.MEMORYMESH_RETRY_MAX_DELAY_MS = "0";
    process.env.MEMORYMESH_RETRY_JITTER_MS = "0";
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
      expect.stringContaining("MATCH (m)-[:BELONGS_TO]->(:Project)<-[:BELONGS_TO]-(related:Memory)"),
      expect.objectContaining({ ids: ["m-1", "m-2"] })
    );
  });

  it("saveNode links memory to project/tags and relation hints", async () => {
    mockRun.mockResolvedValue({ records: [] });
    const graphStore = await import("../graph-store");

    await graphStore.saveNode(
      "m-9",
      "context",
      "MemoryMesh",
      "2026-03-11T12:00:00.000Z",
      ["architecture", "graph"],
      "Graph refactor",
      "MM-900",
      9,
      "conv-1",
      "m-parent",
      "m-base"
    );

    const firstCallQuery = String(mockRun.mock.calls[0][0]);
    expect(firstCallQuery).toContain("MERGE (p:Project {name: $project})");
    expect(firstCallQuery).toContain("MERGE (m)-[bp:BELONGS_TO]->(p)");
    expect(firstCallQuery).toContain("SET bp.kind = 'inferred'");
    expect(mockRun.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        importance: 9,
        conversation_id: "conv-1",
        parent_memory_id: "m-parent",
        derived_from_memory_id: "m-base",
      })
    );

    const allQueries = mockRun.mock.calls.map((call) => String(call[0]));
    const tagCallQuery = allQueries.find((query) =>
      query.includes("MERGE (m)-[ht:HAS_TAG]->(t)")
    );
    expect(tagCallQuery).toBeDefined();
    expect(tagCallQuery).toContain("SET ht.kind = 'inferred'");

    const parentLinkQuery = allQueries.find((query) =>
      query.includes("MERGE (m)-[r:CHILD_OF]->(parent)")
    );
    expect(parentLinkQuery).toBeDefined();
    expect(parentLinkQuery).toContain("SET r.kind = 'explicit'");

    const derivedLinkQuery = allQueries.find((query) =>
      query.includes("MERGE (m)-[r:DERIVED_FROM]->(source)")
    );
    expect(derivedLinkQuery).toBeDefined();
    expect(derivedLinkQuery).toContain("SET r.kind = 'explicit'");
  });

  it("linkNodes creates explicit relation metadata", async () => {
    mockRun.mockResolvedValue({ records: [] });
    const graphStore = await import("../graph-store");

    await graphStore.linkNodes("m-1", "m-2", "depends_on");

    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("MERGE (a)-[r:RELATED {relation_type: $relationType}]->(b)"),
      expect.objectContaining({
        fromId: "m-1",
        toId: "m-2",
        relationType: "DEPENDS_ON",
      })
    );
  });

  it("retries transient neo4j query failure and then succeeds", async () => {
    mockRun
      .mockRejectedValueOnce(
        Object.assign(new Error("database unavailable"), {
          code: "Neo.TransientError.General.DatabaseUnavailable",
        })
      )
      .mockResolvedValueOnce({
        records: [{ get: () => "m-7" }],
      });
    const graphStore = await import("../graph-store");

    const ids = await graphStore.queryByTags(["auth"], 3);

    expect(ids).toEqual(["m-7"]);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });
});
