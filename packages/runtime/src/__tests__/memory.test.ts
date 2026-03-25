import {
  getMemoryStatus,
  getMemoryById,
  getMemoryByRef,
  getRelatedMemories,
  saveMemory,
  saveMemoryForImport,
  waitForBackgroundSaveTasks,
  searchMemory,
  getProjects,
} from "../memory";
import { CancellationToken } from "@memorymesh/core";
import * as embeddings from "../embeddings";
import * as storage from "../storage";
import * as graphStore from "../graph-store";
import * as documentStore from "../document-store";

jest.mock("../embeddings");
jest.mock("../storage");
jest.mock("../graph-store");
jest.mock("../document-store");

const mockEmbed = embeddings.embed as jest.MockedFunction<typeof embeddings.embed>;
const mockEnsure = storage.ensureCollection as jest.MockedFunction<typeof storage.ensureCollection>;
const mockSave = storage.savePoint as jest.MockedFunction<typeof storage.savePoint>;
const mockSearch = storage.searchPoints as jest.MockedFunction<typeof storage.searchPoints>;
const mockGetPointsByIds = storage.getPointsByIds as jest.MockedFunction<typeof storage.getPointsByIds>;
const mockList = storage.listProjects as jest.MockedFunction<typeof storage.listProjects>;
const mockQueryByTags = graphStore.queryByTags as jest.MockedFunction<typeof graphStore.queryByTags>;
const mockQueryByDateRange = graphStore.queryByDateRange as jest.MockedFunction<typeof graphStore.queryByDateRange>;
const mockQueryRelated = graphStore.queryRelated as jest.MockedFunction<typeof graphStore.queryRelated>;
const mockGetRelated = graphStore.getRelated as jest.MockedFunction<typeof graphStore.getRelated>;
const mockSaveNode = graphStore.saveNode as jest.MockedFunction<typeof graphStore.saveNode>;
const mockGetDocuments = documentStore.getDocuments as jest.MockedFunction<typeof documentStore.getDocuments>;
const mockSaveDocument = documentStore.saveDocument as jest.MockedFunction<typeof documentStore.saveDocument>;

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 500
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEmbed.mockResolvedValue(new Array(768).fill(0.1));
  mockEnsure.mockResolvedValue(undefined);
  mockSave.mockResolvedValue("memory-id");
  mockGetPointsByIds.mockResolvedValue([]);
  mockQueryByTags.mockResolvedValue([]);
  mockQueryByDateRange.mockResolvedValue([]);
  mockQueryRelated.mockResolvedValue([]);
  mockGetRelated.mockResolvedValue([]);
  mockSaveNode.mockResolvedValue(true);
  mockGetDocuments.mockResolvedValue(new Map());
  mockSaveDocument.mockResolvedValue(true);
});

describe("saveMemory", () => {
  it("returns pending status with a valid UUID", () => {
    const result = saveMemory({
      content: "We use Postgres for the main database",
      project: "HumanTick",
      memory_type: "decision",
    });

    expect(result.status).toBe("pending");
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(getMemoryStatus(result.id)?.status).toBe("pending");
  });

  it("background save eventually completes", async () => {
    mockSave.mockResolvedValue("abc");

    const result = saveMemory({
      content: "Prefer async/await over callbacks",
      project: "HumanTick",
      memory_type: "preference",
    });

    await waitForCondition(() => mockSave.mock.calls.length === 1);
    expect(mockEmbed).toHaveBeenCalledWith("Prefer async/await over callbacks");
    await waitForCondition(() => getMemoryStatus(result.id)?.status === "saved");
    expect(getMemoryStatus(result.id)?.qdrant_saved).toBe(true);
  });

  it("includes correct payload fields when saving", async () => {
    mockSave.mockResolvedValue("abc");
    const result = saveMemory({
      content: "Prefer async/await over callbacks",
      project: "HumanTick",
      memory_type: "preference",
    });

    await waitForCondition(() => mockSave.mock.calls.length === 1);
    const callArgs = mockSave.mock.calls[0];
    const payload = callArgs[1];
    const pointId = callArgs[2];
    expect(payload.project).toBe("HumanTick");
    expect(payload.memory_type).toBe("preference");
    expect(payload.content).toBe("Prefer async/await over callbacks");
    expect(payload.created_at).toBeDefined();
    expect(pointId).toBe(result.id);
  });

  it("includes tags when provided", async () => {
    mockSave.mockResolvedValue("tag-id");

    saveMemory({
      content: "JWT auth service details",
      project: "HumanTick",
      memory_type: "context",
      tags: ["auth", "jwt"],
    });

    await waitForCondition(() => mockSave.mock.calls.length === 1);
    const payload = mockSave.mock.calls[0][1];
    expect(payload.tags).toEqual(["auth", "jwt"]);
  });

  it("marks output memory as partial when mongo save fails", async () => {
    mockSaveDocument.mockResolvedValue(false);

    const result = saveMemory({
      content: "Long output content",
      project: "HumanTick",
      memory_type: "output",
    });

    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    const status = getMemoryStatus(result.id);
    expect(status?.status).toBe("partial");
    expect(status?.qdrant_saved).toBe(true);
    expect(status?.mongo_saved).toBe(false);
    expect(status?.neo4j_saved).toBe(true);
  });

  it("marks save as failed when qdrant save fails", async () => {
    mockSave.mockRejectedValue(new Error("qdrant down"));

    const result = saveMemory({
      content: "Critical decision",
      project: "HumanTick",
      memory_type: "decision",
    });

    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    const status = getMemoryStatus(result.id);
    expect(status?.status).toBe("failed");
    expect(status?.qdrant_saved).toBe(false);
    expect(status?.mongo_saved).toBe(false);
    expect(status?.neo4j_saved).toBe(false);
  });

  it("marks decision save as partial when neo4j save fails", async () => {
    mockSaveNode.mockResolvedValue(false);

    const result = saveMemory({
      content: "Architecture decision",
      project: "HumanTick",
      memory_type: "decision",
    });

    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    const status = getMemoryStatus(result.id);
    expect(status?.status).toBe("partial");
    expect(status?.qdrant_saved).toBe(true);
    expect(status?.mongo_saved).toBe(false);
    expect(status?.neo4j_saved).toBe(false);
  });

  it("marks output save as saved when all eligible stores succeed", async () => {
    const result = saveMemory({
      content: "Generated doc output",
      project: "HumanTick",
      memory_type: "output",
    });

    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    const status = getMemoryStatus(result.id);
    expect(status?.status).toBe("saved");
    expect(status?.qdrant_saved).toBe(true);
    expect(status?.mongo_saved).toBe(true);
    expect(status?.neo4j_saved).toBe(true);
  });
});

describe("saveMemoryForImport cancellation", () => {
  it("does not start background work when token is already cancelled", () => {
    const token = new CancellationToken();
    token.cancel();

    expect(() =>
      saveMemoryForImport(
        {
          content: "cancelled import",
          project: "MemoryMesh",
          memory_type: "context",
        },
        { cancellationToken: token }
      )
    ).toThrow("Import interrupted by signal");

    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("stops before embedding when cancellation is raised after collection check", async () => {
    const token = new CancellationToken();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockEnsure.mockImplementation(async () => {
      token.cancel();
    });

    const result = saveMemoryForImport(
      {
        content: "cancel during import",
        project: "MemoryMesh",
        memory_type: "context",
      },
      { cancellationToken: token }
    );

    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    expect(getMemoryStatus(result.id)?.error_code).toBe("import_interrupted");
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("waitForBackgroundSaveTasks waits until active background saves settle", async () => {
    let releaseSave: (() => void) | undefined;
    mockSave.mockImplementation(
      async () =>
        new Promise<string>((resolve) => {
          releaseSave = () => resolve("id-delayed");
        })
    );

    const result = saveMemoryForImport({
      content: "delayed save",
      project: "MemoryMesh",
      memory_type: "context",
    });

    await waitForCondition(() => mockSave.mock.calls.length === 1);
    expect(getMemoryStatus(result.id)?.status).toBe("pending");

    const waitPromise = waitForBackgroundSaveTasks();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(getMemoryStatus(result.id)?.status).toBe("pending");

    if (releaseSave) {
      releaseSave();
    }
    await waitPromise;
    await waitForCondition(() => getMemoryStatus(result.id)?.status !== "pending");
    expect(getMemoryStatus(result.id)?.status).toBe("saved");
  });
});

describe("searchMemory", () => {
  it("returns formatted results from storage", async () => {
    mockSearch.mockResolvedValue([
      {
        id: "1",
        content: "We use Postgres",
        project: "HumanTick",
        memory_type: "decision",
        semantic_score: 0.95,
        similarity_score: 0.95,
        created_at: "2024-01-01T00:00:00.000Z",
        tags: ["database", "postgres"],
      },
    ]);

    const results = await searchMemory({ query: "database", project: "HumanTick" });

    expect(mockEmbed).toHaveBeenCalledWith("database");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("We use Postgres");
    expect(results[0].similarity_score).toBe(0.95);
  });

  it("passes limit and project filter to storage", async () => {
    mockSearch.mockResolvedValue([]);

    await searchMemory({ query: "auth", project: "HumanTick", limit: 3 });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        query: "auth",
        project: "HumanTick",
        limit: 3,
      })
    );
  });

  it("passes tags filter to storage", async () => {
    mockSearch.mockResolvedValue([]);

    await searchMemory({
      query: "token strategy",
      project: "HumanTick",
      limit: 5,
      tags: ["auth"],
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        query: "token strategy",
        project: "HumanTick",
        limit: 5,
        tags: ["auth"],
      })
    );
  });

  it("filters by tag when searching", async () => {
    const savedPayloads: Array<{
      id: string;
      content: string;
      project: string;
      memory_type: "decision" | "learning" | "context" | "preference" | "output";
      tags?: string[];
      created_at: string;
    }> = [];

    mockSave.mockImplementation(async (_vector, payload) => {
      const id = `${savedPayloads.length + 1}`;
      savedPayloads.push({ id, ...payload });
      return id;
    });

    mockSearch.mockImplementation(async (_vector, input) => {
      return savedPayloads
        .filter((item) => (input.project ? item.project === input.project : true))
        .filter((item) =>
          input.tags && input.tags.length > 0
            ? input.tags.some((tag) => (item.tags ?? []).includes(tag))
            : true
        )
        .map((item) => ({
          id: item.id,
          content: item.content,
          project: item.project,
          memory_type: item.memory_type,
          semantic_score: 0.9,
          similarity_score: 0.9,
          created_at: item.created_at,
          tags: item.tags,
        }));
    });

    saveMemory({
      content: "Authentication uses JWT",
      project: "HumanTick",
      memory_type: "decision",
      tags: ["auth", "jwt"],
    });
    saveMemory({
      content: "Qdrant stores vectors",
      project: "HumanTick",
      memory_type: "context",
      tags: ["storage", "qdrant"],
    });
    await waitForCondition(() => savedPayloads.length === 2);

    const results = await searchMemory({
      query: "auth flow",
      project: "HumanTick",
      tags: ["auth"],
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Authentication");
    expect(results[0].tags).toContain("auth");
  });

  it("returns empty array when no results", async () => {
    mockSearch.mockResolvedValue([]);
    const results = await searchMemory({ query: "something unknown" });
    expect(results).toHaveLength(0);
  });

  it("bypasses embeddings for exact ref_id lookup", async () => {
    mockSearch.mockResolvedValue([]);

    await searchMemory({ query: "ignored", ref_id: "MM-011", limit: 1 });

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        query: "ignored",
        ref_id: "MM-011",
        limit: 1,
      })
    );
  });

  it("exact ref_id lookup returns the matching memory", async () => {
    const expected = {
      id: "ref-1",
      content: "Prompt details",
      project: "MemoryMesh",
      memory_type: "context" as const,
      semantic_score: 1,
      similarity_score: 1,
      created_at: "2026-03-10T10:00:00.000Z",
      ref_id: "TEST-001",
    };
    mockSearch.mockResolvedValue([expected]);

    const results = await searchMemory({ query: "TEST-001", ref_id: "TEST-001", limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].ref_id).toBe("TEST-001");
  });

  it("passes sort_by oldest and keeps older memory first", async () => {
    mockSearch.mockResolvedValue([
      {
        id: "old",
        content: "Older",
        project: "MemoryMesh",
        memory_type: "context",
        semantic_score: 0.7,
        similarity_score: 0.7,
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "new",
        content: "Newer",
        project: "MemoryMesh",
        memory_type: "context",
        semantic_score: 0.8,
        similarity_score: 0.8,
        created_at: "2026-03-10T10:00:00.000Z",
      },
    ]);

    const results = await searchMemory({
      query: "timeline",
      sort_by: "oldest",
      limit: 2,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ sort_by: "oldest", limit: 2 })
    );
    expect(results[0].id).toBe("old");
  });

  it("passes before/after filters and returns matching memory", async () => {
    mockSearch.mockResolvedValue([
      {
        id: "mid",
        content: "In-range",
        project: "MemoryMesh",
        memory_type: "learning",
        semantic_score: 0.92,
        similarity_score: 0.92,
        created_at: "2026-03-08T12:00:00.000Z",
      },
    ]);

    const results = await searchMemory({
      query: "recent incidents",
      after: "2026-03-07T00:00:00Z",
      before: "2026-03-09T00:00:00Z",
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        after: "2026-03-07T00:00:00Z",
        before: "2026-03-09T00:00:00Z",
      })
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("mid");
  });
});

describe("getProjects", () => {
  it("returns project list from storage", async () => {
    mockList.mockResolvedValue([
      { project: "HumanTick", memory_count: 5 },
      { project: "MemoryMesh", memory_count: 2 },
    ]);

    const projects = await getProjects();

    expect(projects).toHaveLength(2);
    expect(projects[0].project).toBe("HumanTick");
    expect(projects[0].memory_count).toBe(5);
  });
});

describe("exact retrieval", () => {
  it("getMemoryById returns hydrated full content when available", async () => {
    mockGetPointsByIds.mockResolvedValue([
      {
        id: "m1",
        content: "preview content",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-01T00:00:00.000Z",
        ref_id: "MM-100",
      },
    ]);
    mockGetDocuments.mockResolvedValue(new Map([["m1", "full raw content"]]));

    const result = await getMemoryById("m1");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("m1");
    expect(result?.full_content).toBe("full raw content");
  });

  it("getMemoryByRef returns newest-first hydrated matches", async () => {
    mockSearch.mockResolvedValue([
      {
        id: "new",
        content: "new content",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 1,
        similarity_score: 1,
        created_at: "2026-03-10T00:00:00.000Z",
        ref_id: "MM-200",
      },
      {
        id: "old",
        content: "old content",
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 1,
        similarity_score: 1,
        created_at: "2026-03-01T00:00:00.000Z",
        ref_id: "MM-200",
      },
    ]);
    mockGetDocuments.mockResolvedValue(
      new Map([
        ["new", "full new content"],
        ["old", "full old content"],
      ])
    );

    const results = await getMemoryByRef({
      ref_id: "MM-200",
      project: "HumanTick",
    });

    expect(mockSearch).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        query: "MM-200",
        ref_id: "MM-200",
        project: "HumanTick",
        sort_by: "recency",
      })
    );
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("new");
    expect(results[0].full_content).toBe("full new content");
  });
});

describe("related retrieval", () => {
  it("getRelatedMemories returns preview-oriented related entries", async () => {
    mockGetRelated.mockResolvedValue(["m2", "m3", "m1"]);
    mockGetPointsByIds.mockResolvedValue([
      {
        id: "m2",
        content: `function test() {\n  return "ok";\n}\n${"x".repeat(600)}`,
        project: "HumanTick",
        memory_type: "output",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-11T10:00:00.000Z",
      },
      {
        id: "m3",
        content: "Short related content",
        project: "HumanTick",
        memory_type: "context",
        semantic_score: 0,
        similarity_score: 0,
        created_at: "2026-03-11T09:00:00.000Z",
      },
    ]);

    const results = await getRelatedMemories({ id: "m1", limit: 2 });

    expect(mockGetRelated).toHaveBeenCalledWith("m1");
    expect(mockGetPointsByIds).toHaveBeenCalledWith(["m2", "m3"]);
    expect(results).toHaveLength(2);
    expect(results[0].preview).toContain("...[truncated]");
    expect(results[1].preview).toBe("Short related content");
  });
});
