import {
  IProjectSummary,
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISearchMemoryInput,
  ISearchResult,
  MemoryType,
  SourceType,
} from "../types";

describe("@memorymesh/core types", () => {
  it("exposes expected union type literals", () => {
    const memoryType: MemoryType = "context";
    const sourceType: SourceType = "summary";

    expect(memoryType).toBe("context");
    expect(sourceType).toBe("summary");
  });

  it("supports extended save input metadata fields", () => {
    const input: ISaveMemoryInput = {
      content: "Auth design notes",
      project: "MemoryMesh",
      memory_type: "decision",
      created_at: "2026-03-11T10:00:00.000Z",
      importance: 8,
      conversation_id: "conv-123",
      parent_memory_id: "mem-001",
      derived_from_memory_id: "mem-000",
      source_agent: "chatgpt",
      source_format: "gpt_export",
      message_index: 2,
      tags: ["auth", "jwt"],
      title: "Auth decision",
      ref_id: "MM-100",
      source_type: "imported_conversation",
    };

    expect(input.importance).toBe(8);
    expect(input.conversation_id).toBe("conv-123");
    expect(input.source_type).toBe("imported_conversation");
  });

  it("supports save result lifecycle statuses", () => {
    const pending: ISaveMemoryResult = { id: "1", status: "pending" };
    const partial: ISaveMemoryResult = { id: "1", status: "partial" };

    expect(pending.status).toBe("pending");
    expect(partial.status).toBe("partial");
  });

  it("supports search input filters and temporal parameters", () => {
    const query: ISearchMemoryInput = {
      query: "auth flow",
      project: "MemoryMesh",
      tags: ["auth"],
      ref_id: "MM-100",
      source_type: "document",
      sort_by: "recency",
      before: "2026-03-10T00:00:00.000Z",
      after: "2026-03-01T00:00:00.000Z",
    };

    expect(query.sort_by).toBe("recency");
    expect(query.ref_id).toBe("MM-100");
  });

  it("supports search result scoring and extended metadata", () => {
    const result: ISearchResult = {
      id: "mem-123",
      content: "Stored content",
      preview: "Stored content",
      project: "MemoryMesh",
      semantic_score: 0.88,
      similarity_score: 0.88,
      hybrid_score: 0.91,
      memory_type: "output",
      created_at: "2026-03-11T10:00:00.000Z",
      importance: 9,
      conversation_id: "conv-123",
      parent_memory_id: "mem-001",
      derived_from_memory_id: "mem-002",
      source_agent: "chatgpt",
      source_format: "gpt_export",
      message_index: 2,
      tags: ["typescript"],
      full_content: "Long raw content",
      title: "Task output",
      ref_id: "MM-101",
      source_type: "code_block",
    };

    expect(result.hybrid_score).toBe(0.91);
    expect(result.conversation_id).toBe("conv-123");
    expect(result.source_type).toBe("code_block");
  });

  it("supports project summary type", () => {
    const summary: IProjectSummary = {
      project: "MemoryMesh",
      memory_count: 42,
    };

    expect(summary.memory_count).toBe(42);
  });
});
