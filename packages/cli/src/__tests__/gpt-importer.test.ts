import { importConversations } from "../gpt-importer";

const originalFetch = global.fetch;

describe("cli gpt-importer", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    global.fetch = jest.fn(async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              structuredContent: {
                memories: [],
                total: 0,
              },
              content: [{ text: "No memories found for ref_id: test" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("prints progress and dry-run preview lines with skip reasons", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const result = await importConversations(
      [
        {
          title: "Conv A",
          messages: [
            { role: "user", content: "How should we architect auth service?" },
            { role: "system", content: "internal metadata" },
            {
              role: "assistant",
              content: "Decision: we will use JWT with rotating refresh tokens.",
            },
          ],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0 }
    );

    const allLogs = logSpy.mock.calls.flat().join("\n");
    expect(allLogs).toContain("Importing conv 1/1: Conv A (3 msg)");
    expect(allLogs).toContain("[dry-run] IMPORT | role=user | memory_type=context");
    expect(allLogs).toContain("[dry-run] SKIP | role=system | memory_type=- | reason=unsupported_role:system");
    expect(allLogs).toContain("preview:");
    expect(result.saved).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["unsupported_role:system"]).toBe(1);
    expect(global.fetch).toHaveBeenCalled();
  });

  it("waits between conversations with mocked timers", async () => {
    jest.useFakeTimers();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const runPromise = importConversations(
      [
        {
          title: "Conv A",
          messages: [{ role: "user", content: "first" }],
        },
        {
          title: "Conv B",
          messages: [{ role: "assistant", content: "general context" }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 3000 }
    );

    await jest.advanceTimersByTimeAsync(3000);
    const result = await runPromise;

    expect(result.totalConversations).toBe(2);
    expect(result.saved).toBe(2);
    expect(logSpy).toHaveBeenCalledWith("Importing conv 1/2: Conv A (1 msg)");
    expect(logSpy).toHaveBeenCalledWith("Importing conv 2/2: Conv B (1 msg)");
    jest.useRealTimers();
  });

  it("calls MCP endpoint in non-dry-run mode", async () => {
    await importConversations(
      [
        {
          title: "Conv C",
          messages: [{ role: "assistant", content: "Decision: use Postgres." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0 }
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("skip_existing policy reports duplicate skips in dry-run", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              structuredContent: {
                memories: [
                  {
                    id: "existing",
                    ref_id: "test",
                    project: "MemoryMesh",
                    created_at: "2026-03-11T00:00:00.000Z",
                    memory_type: "decision",
                    source_type: "summary",
                  },
                ],
                total: 1,
              },
              content: [{ text: "this text should not matter for dedup" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await importConversations(
      [
        {
          title: "Conv D",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0, importPolicy: "skip_existing" }
    );

    const logs = logSpy.mock.calls.flat().join("\n");
    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["duplicate_ref_id"]).toBe(1);
    expect(logs).toContain("reason=duplicate_ref_id");
  });

  it("import_anyway policy saves even when duplicate exists", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              structuredContent: {
                memories: [
                  {
                    id: "existing",
                    ref_id: "test",
                    project: "MemoryMesh",
                    created_at: "2026-03-11T00:00:00.000Z",
                    memory_type: "decision",
                  },
                ],
                total: 1,
              },
              content: [{ text: "text output ignored by importer dedup" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    });

    const result = await importConversations(
      [
        {
          title: "Conv E",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, importPolicy: "import_anyway" }
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("treats missing structuredContent as empty dedup result", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              content: [{ text: "[1] id=existing | ref_id=test but not structuredContent" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    });

    const result = await importConversations(
      [
        {
          title: "Conv F",
          messages: [{ role: "assistant", content: "Decision: use Kafka." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, importPolicy: "skip_existing" }
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("overwrite_existing reports not supported skip reason", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              structuredContent: {
                memories: [
                  {
                    id: "existing",
                    ref_id: "test",
                    project: "MemoryMesh",
                    created_at: "2026-03-11T00:00:00.000Z",
                    memory_type: "decision",
                  },
                ],
                total: 1,
              },
              content: [{ text: "friendly output only" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    });

    const result = await importConversations(
      [
        {
          title: "Conv G",
          messages: [{ role: "assistant", content: "Decision: use NATS." }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0, importPolicy: "overwrite_existing" }
    );

    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["overwrite_existing_not_supported"]).toBe(1);
  });

  it("ignores weird human-readable text when structured dedup is empty", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string };
      };
      const methodName = body.params?.name;

      if (methodName === "get_memory_by_ref") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              structuredContent: { memories: [], total: 0 },
              content: [{ text: "No memories found? maybe yes? [1] id=random | ref_id=random" }],
            },
          }),
          text: async () => "",
        } as Response;
      }

      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: "ok" }),
        text: async () => "ok",
      } as Response;
    });

    const result = await importConversations(
      [
        {
          title: "Conv H",
          messages: [{ role: "assistant", content: "Decision: use RabbitMQ." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, importPolicy: "skip_existing" }
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
