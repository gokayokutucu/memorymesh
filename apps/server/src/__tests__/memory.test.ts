import { saveMemory, searchMemory, getProjects } from "../memory";
import * as embeddings from "../embeddings";
import * as storage from "../storage";
import * as graphStore from "../graph-store";

jest.mock("../embeddings");
jest.mock("../storage");
jest.mock("../graph-store");

const mockEmbed = embeddings.embed as jest.MockedFunction<typeof embeddings.embed>;
const mockEnsure = storage.ensureCollection as jest.MockedFunction<typeof storage.ensureCollection>;
const mockSave = storage.savePoint as jest.MockedFunction<typeof storage.savePoint>;
const mockSearch = storage.searchPoints as jest.MockedFunction<typeof storage.searchPoints>;
const mockGetPointsByIds = storage.getPointsByIds as jest.MockedFunction<typeof storage.getPointsByIds>;
const mockList = storage.listProjects as jest.MockedFunction<typeof storage.listProjects>;
const mockQueryByTags = graphStore.queryByTags as jest.MockedFunction<typeof graphStore.queryByTags>;
const mockQueryByDateRange = graphStore.queryByDateRange as jest.MockedFunction<typeof graphStore.queryByDateRange>;
const mockQueryRelated = graphStore.queryRelated as jest.MockedFunction<typeof graphStore.queryRelated>;

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
  mockGetPointsByIds.mockResolvedValue([]);
  mockQueryByTags.mockResolvedValue([]);
  mockQueryByDateRange.mockResolvedValue([]);
  mockQueryRelated.mockResolvedValue([]);
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
  });

  it("background save eventually completes", async () => {
    mockSave.mockResolvedValue("abc");

    saveMemory({
      content: "Prefer async/await over callbacks",
      project: "HumanTick",
      memory_type: "preference",
    });

    await waitForCondition(() => mockSave.mock.calls.length === 1);
    expect(mockEmbed).toHaveBeenCalledWith("Prefer async/await over callbacks");
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
});

describe("searchMemory", () => {
  it("returns formatted results from storage", async () => {
    mockSearch.mockResolvedValue([
      {
        id: "1",
        content: "We use Postgres",
        project: "HumanTick",
        memory_type: "decision",
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
        similarity_score: 0.7,
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "new",
        content: "Newer",
        project: "MemoryMesh",
        memory_type: "context",
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
