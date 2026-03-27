import {
  formatRuntimeHealthToolText,
  formatSaveMemoryToolText,
  formatSearchMemoryToolText,
} from "../tool-formatters";

describe("tool formatters", () => {
  it("formats skipped save response deterministically", () => {
    const text = formatSaveMemoryToolText({
      id: "id-1",
      status: "skipped",
      reason: "memory_write_disabled",
    });

    expect(text).toBe(
      JSON.stringify({
        status: "skipped",
        reason: "memory_write_disabled",
      })
    );
  });

  it("formats empty search response as deterministic JSON", () => {
    const text = formatSearchMemoryToolText([]);
    expect(text).toBe(JSON.stringify({ results: [] }));
  });

  it("formats runtime health payload as deterministic JSON", () => {
    const text = formatRuntimeHealthToolText({
      mode: "READ_ONLY",
      read_tools_enabled: true,
      write_tools_enabled: false,
      registered_tools: ["get_runtime_health", "search_memory"],
      stores: {
        qdrant: {
          store: "qdrant",
          state: "healthy",
          consecutive_failures: 0,
        },
        mongo: {
          store: "mongo",
          state: "degraded",
          consecutive_failures: 1,
          last_error: "timeout",
        },
        neo4j: {
          store: "neo4j",
          state: "open",
          consecutive_failures: 3,
        },
      },
    });
    expect(text).toBe(
      JSON.stringify({
        mode: "READ_ONLY",
        read_tools_enabled: true,
        write_tools_enabled: false,
        registered_tools: ["get_runtime_health", "search_memory"],
        stores: {
          qdrant: {
            store: "qdrant",
            state: "healthy",
            consecutive_failures: 0,
          },
          mongo: {
            store: "mongo",
            state: "degraded",
            consecutive_failures: 1,
            last_error: "timeout",
          },
          neo4j: {
            store: "neo4j",
            state: "open",
            consecutive_failures: 3,
          },
        },
      })
    );
  });
});
