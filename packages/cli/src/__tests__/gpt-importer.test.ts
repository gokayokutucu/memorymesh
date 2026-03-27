import { IImporterGateway, ISaveMemoryInput, ISearchResult } from "@memorymesh/core";
import { importConversations } from "../gpt-importer";
import {
  createRuntimeImporterGateway,
  ensureEmbeddingModelAvailable,
} from "@memorymesh/runtime";

jest.mock("@memorymesh/runtime", () => ({
  createRuntimeImporterGateway: jest.fn(),
  ensureEmbeddingModelAvailable: jest.fn(),
  waitForBackgroundSaveTasks: jest.fn(async () => undefined),
}));

const createRuntimeImporterGatewayMock = jest.mocked(createRuntimeImporterGateway);
const ensureEmbeddingModelAvailableMock = jest.mocked(ensureEmbeddingModelAvailable);
const runtimeModule = jest.requireMock("@memorymesh/runtime") as {
  waitForBackgroundSaveTasks: jest.Mock<Promise<void>, []>;
};
const waitForBackgroundSaveTasksMock = runtimeModule.waitForBackgroundSaveTasks;

function createGateway(
  getByRef: (refId: string, project?: string) => Promise<ISearchResult[]>,
  onSave?: (input: ISaveMemoryInput) => Promise<void>
): IImporterGateway {
  return {
    async saveMemory(input: ISaveMemoryInput): Promise<void> {
      if (onSave) {
        await onSave(input);
      }
    },
    async getMemoryByRef(refId: string, project?: string): Promise<ISearchResult[]> {
      return getByRef(refId, project);
    },
  };
}

describe("cli gpt-importer local gateway path", () => {
  beforeEach(() => {
    createRuntimeImporterGatewayMock.mockReset();
    ensureEmbeddingModelAvailableMock.mockReset();
    waitForBackgroundSaveTasksMock.mockReset();
    waitForBackgroundSaveTasksMock.mockResolvedValue(undefined);
  });

  it("runs quiet by default and shows progress output", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const fetchSpy = jest.spyOn(global, "fetch" as never);
    fetchSpy.mockImplementation(() => {
      throw new Error("fetch should not be used in local gateway mode");
    });

    const gateway = createGateway(async () => []);
    const result = await importConversations(
      [
        {
          title: "Conv A",
          messages: [
            { role: "user", content: "How should we architect auth service?" },
            { role: "system", content: "internal metadata" },
            { role: "assistant", content: "Decision: use JWT." },
          ],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0, gateway }
    );

    const allLogs = logSpy.mock.calls.flat().join("\n");
    expect(allLogs).not.toContain("[dry-run]");
    const progressOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(progressOutput).toContain("[progress]");
    expect(result.saved).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["unsupported_role:system"]).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows per-message logs when verbose is enabled", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const gateway = createGateway(async () => []);

    await importConversations(
      [
        {
          title: "Conv Verbose",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0, verbose: true, gateway }
    );

    const allLogs = logSpy.mock.calls.flat().join("\n");
    expect(allLogs).toContain("[dry-run] IMPORT");
  });

  it("skip_existing policy skips duplicates", async () => {
    const gateway = createGateway(async () => [
      {
        id: "existing",
        content: "",
        project: "MemoryMesh",
        memory_type: "context",
        semantic_score: 1,
        similarity_score: 1,
        created_at: new Date().toISOString(),
        ref_id: "test-ref",
      },
    ]);

    const result = await importConversations(
      [
        {
          title: "Conv D",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0, importPolicy: "skip_existing", gateway }
    );

    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["duplicate_ref_id"]).toBe(1);
  });

  it("import_anyway policy keeps importing duplicates", async () => {
    let saveCalls = 0;
    const gateway = createGateway(
      async () => [
        {
          id: "existing",
          content: "",
          project: "MemoryMesh",
          memory_type: "context",
          semantic_score: 1,
          similarity_score: 1,
          created_at: new Date().toISOString(),
          ref_id: "test-ref",
        },
      ],
      async () => {
        saveCalls += 1;
      }
    );

    const result = await importConversations(
      [
        {
          title: "Conv E",
          messages: [{ role: "assistant", content: "Decision: use Kafka." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, importPolicy: "import_anyway", gateway }
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);
    expect(saveCalls).toBe(1);
  });

  it("continues import when save fails with payload_too_large", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const gateway = createGateway(
      async () => [],
      async (input) => {
        if (input.content.includes("oversized")) {
          const error = new Error("payload_too_large");
          (error as Error & { code?: string; payload_bytes?: number }).code =
            "payload_too_large";
          (error as Error & { code?: string; payload_bytes?: number }).payload_bytes = 2048;
          throw error;
        }
      }
    );

    const result = await importConversations(
      [
        {
          title: "Conv Survivability",
          messages: [
            { role: "assistant", content: "oversized message body that fails save" },
            { role: "assistant", content: "Decision: use queue retry." },
          ],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, verbose: true, gateway }
    );

    const allLogs = logSpy.mock.calls.flat().join("\n");
    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["payload_too_large"]).toBe(1);
    expect(allLogs).toContain("reason=payload_too_large");
    expect(allLogs).toContain("payload_bytes=2048");
  });

  it("continues import when save fails with embedding_input_too_large", async () => {
    const gateway = createGateway(
      async () => [],
      async (input) => {
        if (input.content.includes("huge-context")) {
          const error = new Error("embedding_input_too_large");
          (error as Error & { code?: string; payload_bytes?: number }).code =
            "embedding_input_too_large";
          (error as Error & { code?: string; payload_bytes?: number }).payload_bytes = 8192;
          throw error;
        }
      }
    );

    const result = await importConversations(
      [
        {
          title: "Conv Embedding",
          messages: [
            { role: "assistant", content: "huge-context data block that cannot embed" },
            { role: "assistant", content: "Decision: continue with smaller note." },
          ],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, verbose: true, gateway }
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skippedReasons["embedding_input_too_large"]).toBe(1);
  });

  it("fails early when embedding model preflight fails in local real-import mode", async () => {
    ensureEmbeddingModelAvailableMock.mockRejectedValue(
      Object.assign(new Error("embedding model missing"), {
        code: "embedding_model_missing",
      })
    );
    createRuntimeImporterGatewayMock.mockReturnValue(
      createGateway(async () => [], async () => {})
    );

    await expect(
      importConversations(
        [
          {
            title: "Conv Preflight",
            messages: [{ role: "assistant", content: "Decision: proceed." }],
          },
        ],
        "MemoryMesh",
        false
      )
    ).rejects.toMatchObject({
      code: "embedding_model_missing",
    });
    expect(ensureEmbeddingModelAvailableMock).toHaveBeenCalledTimes(1);
  });

  it("waits for runtime background saves before returning in local real-import mode", async () => {
    const gateway = createGateway(async () => [], async () => undefined);

    await importConversations(
      [
        {
          title: "Conv Wait",
          messages: [{ role: "assistant", content: "Decision: wait for background save." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0, gateway }
    );

    expect(waitForBackgroundSaveTasksMock).not.toHaveBeenCalled();
  });

  it("waits for runtime background saves when using default local runtime gateway", async () => {
    createRuntimeImporterGatewayMock.mockReturnValue(
      createGateway(async () => [], async () => undefined)
    );

    await importConversations(
      [
        {
          title: "Conv Wait Runtime",
          messages: [{ role: "assistant", content: "Decision: use local runtime gateway." }],
        },
      ],
      "MemoryMesh",
      false,
      { delayMs: 0 }
    );

    expect(waitForBackgroundSaveTasksMock).toHaveBeenCalledTimes(1);
  });
});
