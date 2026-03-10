import { orchestrateSave, orchestrateSearch } from "../orchestrator";
import * as storage from "../storage";
import * as documentStore from "../document-store";
import * as graphStore from "../graph-store";

jest.mock("../storage");
jest.mock("../document-store");
jest.mock("../graph-store");

const mockSavePoint = storage.savePoint as jest.MockedFunction<typeof storage.savePoint>;
const mockSearchPoints = storage.searchPoints as jest.MockedFunction<typeof storage.searchPoints>;
const mockSaveDocument = documentStore.saveDocument as jest.MockedFunction<typeof documentStore.saveDocument>;
const mockGetDocuments = documentStore.getDocuments as jest.MockedFunction<typeof documentStore.getDocuments>;
const mockSaveNode = graphStore.saveNode as jest.MockedFunction<typeof graphStore.saveNode>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSavePoint.mockResolvedValue("memory-id");
  mockGetDocuments.mockResolvedValue(new Map());
});

describe("orchestrateSave", () => {
  it("decision routes to Qdrant + Neo4j only", async () => {
    const id = await orchestrateSave(
      {
        content: "We decided to use Redis cache",
        project: "HumanTick",
        memory_type: "decision",
        tags: ["cache", "redis"],
      },
      new Array(768).fill(0.1)
    );

    expect(id).toBe("memory-id");
    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveNode).toHaveBeenCalledWith(
      "memory-id",
      "decision",
      "HumanTick",
      ["cache", "redis"]
    );
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it("output routes to all three stores", async () => {
    await orchestrateSave(
      {
        content: "Generated output block",
        project: "HumanTick",
        memory_type: "output",
        tags: ["output", "report"],
      },
      new Array(768).fill(0.1)
    );

    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveDocument).toHaveBeenCalledTimes(1);
    expect(mockSaveNode).toHaveBeenCalledTimes(1);
  });

  it("preference routes only to Qdrant", async () => {
    await orchestrateSave(
      {
        content: "Prefer concise replies",
        project: "HumanTick",
        memory_type: "preference",
      },
      new Array(768).fill(0.1)
    );

    expect(mockSavePoint).toHaveBeenCalledTimes(1);
    expect(mockSaveDocument).not.toHaveBeenCalled();
    expect(mockSaveNode).not.toHaveBeenCalled();
  });
});

describe("orchestrateSearch", () => {
  it("enriches Qdrant results with full_content from MongoDB", async () => {
    mockSearchPoints.mockResolvedValue([
      {
        id: "a1",
        content: "short",
        project: "HumanTick",
        memory_type: "output",
        similarity_score: 0.8,
        created_at: new Date().toISOString(),
        tags: ["report"],
      },
    ]);
    mockGetDocuments.mockResolvedValue(new Map([["a1", "full output text"]]));

    const results = await orchestrateSearch(new Array(768).fill(0.1), {
      query: "report",
      project: "HumanTick",
      tags: ["report"],
      limit: 3,
    });

    expect(mockSearchPoints).toHaveBeenCalledWith(
      expect.any(Array),
      "HumanTick",
      3,
      ["report"]
    );
    expect(results[0].full_content).toBe("full output text");
  });
});
