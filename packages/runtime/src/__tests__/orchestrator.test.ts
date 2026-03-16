import {
  orchestrateSave,
  orchestrateSearch,
  buildPreview,
  hydrateSearchResultsWithFullContent,
} from "../orchestrator";
import * as storage from "../storage";
import * as documentStore from "../document-store";
import * as graphStore from "../graph-store";

jest.mock("../storage");
jest.mock("../document-store");
jest.mock("../graph-store");

const mockSavePoint = storage.savePoint as jest.MockedFunction<typeof storage.savePoint>;
const mockSearchPoints = storage.searchPoints as jest.MockedFunction<typeof storage.searchPoints>;
const mockGetPointsByIds = storage.getPointsByIds as jest.MockedFunction<typeof storage.getPointsByIds>;
const mockSaveDocument = documentStore.saveDocument as jest.MockedFunction<typeof documentStore.saveDocument>;
const mockGetDocuments = documentStore.getDocuments as jest.MockedFunction<typeof documentStore.getDocuments>;
const mockSaveNode = graphStore.saveNode as jest.MockedFunction<typeof graphStore.saveNode>;
const mockQueryByTags = graphStore.queryByTags as jest.MockedFunction<typeof graphStore.queryByTags>;
const mockQueryByDateRange = graphStore.queryByDateRange as jest.MockedFunction<typeof graphStore.queryByDateRange>;
const mockQueryRelated = graphStore.queryRelated as jest.MockedFunction<typeof graphStore.queryRelated>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MEMORYMESH_RETRIEVAL_MODE;
  delete process.env.MEMORYMESH_PREVIEW_MAX_CHARS;
  delete process.env.MEMORYMESH_PREVIEW_MAX_LINES;
  delete process.env.MEMORYMESH_ADAPTIVE_THRESHOLD;
  mockSavePoint.mockResolvedValue("memory-id");
  mockSaveDocument.mockResolvedValue(true);
  mockSaveNode.mockResolvedValue(true);
  mockGetDocuments.mockResolvedValue(new Map());
  mockGetPointsByIds.mockResolvedValue([]);
  mockQueryByTags.mockResolvedValue([]);
  mockQueryByDateRange.mockResolvedValue([]);
  mockQueryRelated.mockResolvedValue([]);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("orchestrateSave", () => {
  it("decision routes to Qdrant + Neo4j only", async () => {
    const result = await orchestrateSave(
      {
        content: "We decided to use Redis cache",
        project: "HumanTick",
        memory_type: "decision",
        tags: ["cache", "redis"],
      },
      new Array(768).fill(0.1)
    );

    expect(result.id).toBe("memory-id");
    expect(result.qdrant_saved).toBe(true);
    expect(result.neo4j_saved).toBe(true);
    expect(result.mongo_saved).toBe(false);
    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveNode).toHaveBeenCalledWith(
      "memory-id",
      "decision",
      "HumanTick",
      expect.any(String),
      ["cache", "redis"],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it("output routes to all three stores", async () => {
    const result = await orchestrateSave(
      {
        content: "Generated output block",
        project: "HumanTick",
        memory_type: "output",
        tags: ["output", "report"],
        title: "MM-012",
        ref_id: "MM-012",
        source_type: "document",
      },
      new Array(768).fill(0.1)
    );

    expect(result.qdrant_saved).toBe(true);
    expect(result.mongo_saved).toBe(true);
    expect(result.neo4j_saved).toBe(true);
    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveDocument).toHaveBeenCalledWith(
      "memory-id",
      "Generated output block",
      expect.objectContaining({
        project: "HumanTick",
        memory_type: "output",
        tags: ["output", "report"],
        title: "MM-012",
        ref_id: "MM-012",
        source_type: "document",
      })
    );
    expect(mockSaveNode).toHaveBeenCalledWith(
      "memory-id",
      "output",
      "HumanTick",
      expect.any(String),
      ["output", "report"],
      "MM-012",
      "MM-012",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it("preference routes only to Qdrant", async () => {
    const result = await orchestrateSave(
      {
        content: "Prefer concise replies",
        project: "HumanTick",
        memory_type: "preference",
      },
      new Array(768).fill(0.1)
    );

    expect(result.qdrant_saved).toBe(true);
    expect(result.mongo_saved).toBe(false);
    expect(result.neo4j_saved).toBe(false);
    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveDocument).not.toHaveBeenCalled();
    expect(mockSaveNode).not.toHaveBeenCalled();
  });
});

describe("orchestrateSearch", () => {
  it("returns preview-oriented results by default", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "a1",
        content: "short",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0.8,
        similarity_score: 0.8,
        created_at: new Date().toISOString(),
        tags: ["report"],
      },
    ]);
    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "report",
      project: "HumanTick",
      tags: ["report"],
      limit: 3,
    });

    expect(mockSearchPoints).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        query: "report",
        project: "HumanTick",
        tags: ["report"],
        limit: 3,
      })
    );
    expect(mockQueryByTags).toHaveBeenCalledWith(["report"], 3);
    expect(mockQueryRelated).toHaveBeenCalledWith(["a1"], 3);
    expect(mockGetDocuments).not.toHaveBeenCalled();
    expect(results[0].preview).toBe("short");
    expect(results[0].full_content).toBeUndefined();
  });

  it("returns full content in search results when mode is full", async () => {
    process.env.MEMORYMESH_RETRIEVAL_MODE = "full";
    mockSearchPoints.mockResolvedValue([
      {
        id: "m1",
        content: "payload preview text",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0.9,
        similarity_score: 0.9,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);
    mockGetDocuments.mockResolvedValue(new Map([["m1", "FULL CONTENT FROM MONGO"]]));

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "output",
      limit: 1,
    });

    expect(results[0].content).toBe("FULL CONTENT FROM MONGO");
    expect(results[0].preview).toBeUndefined();
  });

  it("uses adaptive mode: small content returns full", async () => {
    process.env.MEMORYMESH_RETRIEVAL_MODE = "adaptive";
    process.env.MEMORYMESH_ADAPTIVE_THRESHOLD = "30";
    mockSearchPoints.mockResolvedValue([
      {
        id: "m2",
        content: "payload text",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0.8,
        similarity_score: 0.8,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);
    mockGetDocuments.mockResolvedValue(new Map([["m2", "short full text"]]));

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "short",
      limit: 1,
    });

    expect(results[0].content).toBe("short full text");
    expect(results[0].preview).toBeUndefined();
  });

  it("uses adaptive mode: large content returns preview", async () => {
    process.env.MEMORYMESH_RETRIEVAL_MODE = "adaptive";
    process.env.MEMORYMESH_ADAPTIVE_THRESHOLD = "20";
    process.env.MEMORYMESH_PREVIEW_MAX_CHARS = "40";
    process.env.MEMORYMESH_PREVIEW_MAX_LINES = "2";
    mockSearchPoints.mockResolvedValue([
      {
        id: "m3",
        content: "payload text",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0.8,
        similarity_score: 0.8,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);
    mockGetDocuments.mockResolvedValue(
      new Map([["m3", "line-1\nline-2\nline-3 with a lot more text to force truncation"]])
    );

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "large",
      limit: 1,
    });

    expect(results[0].preview).toContain("...[truncated]");
    expect(results[0].preview).toContain("line-1");
  });

  it("passes ref_id, title, and source_type filters to Qdrant search", async () => {
    mockSearchPoints.mockResolvedValue([]);

    await orchestrateSearch(new Array(768).fill(0.1), {
      query: "MM-012",
      ref_id: "MM-012",
      title: "Task Plan",
      source_type: "document",
      limit: 1,
    });

    expect(mockSearchPoints).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        query: "MM-012",
        ref_id: "MM-012",
        title: "Task Plan",
        source_type: "document",
        limit: 1,
      })
    );
  });

  it("merges graph IDs and fetches missing records from Qdrant by ID", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "q1",
        content: "from vector",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.95,
        similarity_score: 0.95,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);
    mockQueryByTags.mockResolvedValue(["g1"]);
    mockQueryByDateRange.mockResolvedValue(["g2"]);
    mockQueryRelated.mockResolvedValue(["g3"]);
    mockGetPointsByIds.mockResolvedValue([
      {
        id: "g1",
        content: "from tag query",
        project: "HumanTick",
        memory_type: "learning",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-09T10:00:00.000Z",
      },
      {
        id: "g2",
        content: "from date query",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-08T10:00:00.000Z",
      },
      {
        id: "g3",
        content: "related",
        project: "HumanTick",
        memory_type: "decision",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-07T10:00:00.000Z",
      },
    ]);

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "architecture",
      project: "HumanTick",
      tags: ["arch"],
      after: "2026-03-01T00:00:00Z",
      limit: 4,
    });

    expect(mockGetPointsByIds).toHaveBeenCalledWith(["g1", "g2", "g3"]);
    expect(results).toHaveLength(4);
  });

  it("uses hybrid relevance ranking in default mode", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "q-low",
        content: "low semantic base",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.62,
        similarity_score: 0.62,
        created_at: "2026-03-10T10:00:00.000Z",
        tags: ["auth", "jwt"],
      },
      {
        id: "q-high",
        content: "high semantic base",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.64,
        similarity_score: 0.64,
        created_at: "2026-03-01T10:00:00.000Z",
        tags: ["infra"],
      },
    ]);
    mockQueryByTags.mockResolvedValue(["q-low"]);
    mockQueryByDateRange.mockResolvedValue([]);
    mockQueryRelated.mockResolvedValue([]);

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "auth setup",
      project: "HumanTick",
      tags: ["auth"],
      limit: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("q-low");
    expect(results[1].id).toBe("q-high");
  });

  it("keeps recency mode date-driven", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "older-high",
        content: "older",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.95,
        similarity_score: 0.95,
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "newer-low",
        content: "newer",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.2,
        similarity_score: 0.2,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "timeline",
      sort_by: "recency",
      limit: 2,
    });

    expect(results[0].id).toBe("newer-low");
    expect(results[1].id).toBe("older-high");
  });

  it("keeps oldest mode date-driven", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "older",
        content: "older",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.2,
        similarity_score: 0.2,
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "newer",
        content: "newer",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.95,
        similarity_score: 0.95,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "timeline",
      sort_by: "oldest",
      limit: 2,
    });

    expect(results[0].id).toBe("older");
    expect(results[1].id).toBe("newer");
  });

  it("attaches hybrid_score in relevance ranking mode", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "a",
        content: "auth context",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.7,
        similarity_score: 0.7,
        created_at: "2026-03-10T10:00:00.000Z",
        tags: ["auth"],
      },
      {
        id: "b",
        content: "infra context",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0.6,
        similarity_score: 0.6,
        created_at: "2026-03-01T10:00:00.000Z",
        tags: ["infra"],
      },
    ]);
    mockQueryByTags.mockResolvedValue(["a"]);

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "auth",
      project: "HumanTick",
      tags: ["auth"],
      sort_by: "relevance",
      limit: 2,
    });

    expect(results[0].hybrid_score).toBeDefined();
    expect(results[1].hybrid_score).toBeDefined();
    expect((results[0].hybrid_score ?? 0)).toBeGreaterThan(results[1].hybrid_score ?? 0);
  });

  it("can hydrate full content explicitly when needed", async () => {
    const base = [
      {
        id: "a1",
        content: "preview",
        project: "HumanTick",
        memory_type: "output" as const,
        semantic_score: 0.8,
        similarity_score: 0.8,
        created_at: new Date().toISOString(),
      },
    ];
    mockGetDocuments.mockResolvedValue(new Map([["a1", "full output text"]]));

    const hydrated = await hydrateSearchResultsWithFullContent(base);

    expect(mockGetDocuments).toHaveBeenCalledWith(["a1"]);
    expect(hydrated[0].full_content).toBe("full output text");
  });
});

describe("buildPreview", () => {
  it("returns original content for short text", () => {
    expect(buildPreview("short text", 50)).toBe("short text");
  });

  it("truncates long content safely", () => {
    const content = `line1 ${"x".repeat(600)}`;
    const preview = buildPreview(content, 120);
    expect(preview).toContain("...[truncated]");
    expect(preview.length).toBeLessThanOrEqual(140);
  });

  it("truncates by line budget for multi-line documents", () => {
    const content = [
      "line-1",
      "line-2",
      "line-3",
      "line-4",
      "line-5",
    ].join("\n");

    const preview = buildPreview(content, 120, 3);

    expect(preview).toContain("line-1\nline-2\nline-3");
    expect(preview).toContain("...[truncated]");
    expect(preview).not.toContain("line-5");
  });

  it("keeps code-like token boundaries reasonably intact", () => {
    const content = "const veryLongIdentifierWithoutSpaces = buildComplexObjectFromInput(payload);";
    const preview = buildPreview(content, 45);
    expect(preview).toContain("...[truncated]");
    expect(preview).not.toContain("\n\n");
  });
});
