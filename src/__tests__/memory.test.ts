import { saveMemory, searchMemory, getProjects } from "../memory";
import * as embeddings from "../embeddings";
import * as storage from "../storage";

jest.mock("../embeddings");
jest.mock("../storage");

const mockEmbed = embeddings.embed as jest.MockedFunction<typeof embeddings.embed>;
const mockEnsure = storage.ensureCollection as jest.MockedFunction<typeof storage.ensureCollection>;
const mockSave = storage.savePoint as jest.MockedFunction<typeof storage.savePoint>;
const mockSearch = storage.searchPoints as jest.MockedFunction<typeof storage.searchPoints>;
const mockList = storage.listProjects as jest.MockedFunction<typeof storage.listProjects>;

beforeEach(() => {
  jest.clearAllMocks();
  mockEmbed.mockResolvedValue(new Array(768).fill(0.1));
  mockEnsure.mockResolvedValue(undefined);
});

describe("saveMemory", () => {
  it("embeds content and saves to storage, returns an id", async () => {
    mockSave.mockResolvedValue("test-id-123");

    const id = await saveMemory({
      content: "We use Postgres for the main database",
      project: "HumanTick",
      memory_type: "decision",
    });

    expect(mockEmbed).toHaveBeenCalledWith("We use Postgres for the main database");
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(id).toBe("test-id-123");
  });

  it("includes correct payload fields when saving", async () => {
    mockSave.mockResolvedValue("abc");

    await saveMemory({
      content: "Prefer async/await over callbacks",
      project: "HumanTick",
      memory_type: "preference",
    });

    const callArgs = mockSave.mock.calls[0];
    const payload = callArgs[1];
    expect(payload.project).toBe("HumanTick");
    expect(payload.memory_type).toBe("preference");
    expect(payload.content).toBe("Prefer async/await over callbacks");
    expect(payload.created_at).toBeDefined();
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
      "HumanTick",
      3
    );
  });

  it("returns empty array when no results", async () => {
    mockSearch.mockResolvedValue([]);
    const results = await searchMemory({ query: "something unknown" });
    expect(results).toHaveLength(0);
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
