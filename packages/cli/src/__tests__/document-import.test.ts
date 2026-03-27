import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImportInterruptedError } from "@memorymesh/core";
import { importDocumentsFromPath } from "../document-import";

const mockSaveMemory = jest.fn<Promise<void>, [unknown]>();
const mockGetMemoryByRef = jest.fn<Promise<Array<{ id: string }>>, [string, string | undefined]>();
const mockDeleteMemoriesByIds = jest.fn<Promise<void>, [string[]]>();
const mockEnsureEmbeddingModelAvailable = jest.fn<Promise<void>, []>();
const mockWaitForBackgroundSaveTasks = jest.fn<Promise<void>, []>();

jest.mock("@memorymesh/runtime", () => ({
  createRuntimeImporterGateway: () => ({
    saveMemory: (input: unknown) => mockSaveMemory(input),
    getMemoryByRef: (refId: string, project?: string) => mockGetMemoryByRef(refId, project),
    deleteMemoriesByIds: (ids: string[]) => mockDeleteMemoriesByIds(ids),
  }),
  ensureEmbeddingModelAvailable: () => mockEnsureEmbeddingModelAvailable(),
  waitForBackgroundSaveTasks: () => mockWaitForBackgroundSaveTasks(),
}));

describe("document-import", () => {
  let root: string;
  let homeDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "memorymesh-doc-import-"));
    homeDir = join(root, "home");
    mkdirSync(join(homeDir, ".memorymesh"), { recursive: true });
    writeFileSync(
      join(homeDir, ".memorymesh", "config.json"),
      JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: new Date().toISOString(),
        stackProjectDir: join(homeDir, ".memorymesh", "stack"),
        composeFilePath: join(homeDir, ".memorymesh", "stack", "docker-compose.yml"),
      })
    );
    mockGetMemoryByRef.mockResolvedValue([]);
    mockSaveMemory.mockResolvedValue();
    mockEnsureEmbeddingModelAvailable.mockResolvedValue();
    mockWaitForBackgroundSaveTasks.mockResolvedValue();
    mockDeleteMemoriesByIds.mockResolvedValue();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("recursively discovers supported files and skips unsupported ones", async () => {
    mkdirSync(join(root, "docs", "nested"), { recursive: true });
    writeFileSync(join(root, "docs", "a.txt"), "hello world");
    writeFileSync(join(root, "docs", "nested", "b.md"), "# title\ncontent");
    writeFileSync(join(root, "docs", "nested", "c.png"), "binary");

    const summary = await importDocumentsFromPath(join(root, "docs"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.discoveredFiles).toBe(3);
    expect(summary.supportedFiles).toBe(2);
    expect(summary.importedChunks).toBeGreaterThan(0);
  });

  it("parses csv rows into chunks", async () => {
    writeFileSync(join(root, "rows.csv"), "name,age\nalice,30\nbob,25\n");

    const summary = await importDocumentsFromPath(join(root, "rows.csv"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.importedChunks).toBe(2);
  });

  it("parses json array and object", async () => {
    writeFileSync(join(root, "arr.json"), JSON.stringify([{ a: 1 }, { b: 2 }]));
    writeFileSync(join(root, "obj.json"), JSON.stringify({ title: "single" }));

    const arrSummary = await importDocumentsFromPath(join(root, "arr.json"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });
    const objSummary = await importDocumentsFromPath(join(root, "obj.json"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(arrSummary.importedChunks).toBe(2);
    expect(objSummary.importedChunks).toBe(1);
  });

  it("parses jsonl records", async () => {
    writeFileSync(join(root, "data.jsonl"), '{"a":1}\n{"b":2}\n');

    const summary = await importDocumentsFromPath(join(root, "data.jsonl"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.importedChunks).toBe(2);
  });

  it("chunks markdown/text by configured chunk size and overlap", async () => {
    writeFileSync(
      join(homeDir, ".memorymesh", "config.json"),
      JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: new Date().toISOString(),
        stackProjectDir: join(homeDir, ".memorymesh", "stack"),
        composeFilePath: join(homeDir, ".memorymesh", "stack", "docker-compose.yml"),
        documentImportLimits: {
          max_file_size_mb: 5,
          max_chars_per_file: 100000,
          max_chunks_per_file: 200,
          chunk_size: 10,
          chunk_overlap: 3,
        },
      })
    );
    writeFileSync(join(root, "notes.md"), "abcdefghijklmnopqrstuvwxyz");

    const summary = await importDocumentsFromPath(join(root, "notes.md"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.importedChunks).toBeGreaterThan(2);
  });

  it("propagates source metadata/context into saved payload", async () => {
    writeFileSync(join(root, "context.txt"), "line one\nline two");

    await importDocumentsFromPath(join(root, "context.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
    });

    expect(mockSaveMemory).toHaveBeenCalled();
    const payload = mockSaveMemory.mock.calls[0][0] as {
      content: string;
      source_format: string;
      tags: string[];
      source_type: string;
      ref_id: string;
      source_metadata: {
        filename: string;
        source_path: string;
        relative_path: string;
        source_extension: string;
        chunk_index: number;
        chunk_total: number;
        project: string;
        ref_id: string;
      };
    };
    expect(payload.source_format).toBe("document_import_v1");
    expect(payload.source_type).toBe("document");
    expect(payload.content).toContain("source_path:");
    expect(payload.content).toContain("chunk_index:");
    expect(payload.tags).toEqual(expect.arrayContaining(["document-import"]));
    expect(payload.source_metadata.filename).toBe("context.txt");
    expect(payload.source_metadata.source_extension).toBe("txt");
    expect(payload.source_metadata.project).toBe("MemoryMesh");
    expect(payload.source_metadata.ref_id).toBe(payload.ref_id);
  });

  it("skips oversized files by configured max_file_size_mb", async () => {
    writeFileSync(
      join(homeDir, ".memorymesh", "config.json"),
      JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: new Date().toISOString(),
        stackProjectDir: join(homeDir, ".memorymesh", "stack"),
        composeFilePath: join(homeDir, ".memorymesh", "stack", "docker-compose.yml"),
        documentImportLimits: {
          max_file_size_mb: 1,
          max_chars_per_file: 100000,
          max_chunks_per_file: 200,
          chunk_size: 1200,
          chunk_overlap: 150,
        },
      })
    );
    const tooLarge = "x".repeat(2 * 1024 * 1024);
    writeFileSync(join(root, "big.txt"), tooLarge);

    const summary = await importDocumentsFromPath(join(root, "big.txt"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.skipReasons.file_exceeds_max_size).toBe(1);
  });

  it("resumes from checkpoint after interruption", async () => {
    process.env.MEMORYMESH_CHECKPOINT_DIR = join(root, "checkpoints");
    writeFileSync(join(root, "resume.csv"), "id,text\n1,a\n2,b\n3,c\n");

    let callCount = 0;
    mockSaveMemory.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new ImportInterruptedError();
      }
    });

    await expect(
      importDocumentsFromPath(join(root, "resume.csv"), {
        project: "MemoryMesh",
        dryRun: false,
        homeDir,
      })
    ).rejects.toBeInstanceOf(ImportInterruptedError);

    mockSaveMemory.mockResolvedValue();
    callCount = 0;

    const summary = await importDocumentsFromPath(join(root, "resume.csv"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
    });

    expect(summary.resumed).toBe(true);
    expect(summary.importedChunks).toBe(2);
    expect(summary.checkpointPath && existsSync(summary.checkpointPath)).toBe(true);

    delete process.env.MEMORYMESH_CHECKPOINT_DIR;
  });

  it("supports skip_existing policy by checking existing ref ids", async () => {
    writeFileSync(join(root, "skip.txt"), "first\nsecond\n");
    mockGetMemoryByRef.mockResolvedValueOnce([{ id: "existing" }]).mockResolvedValue([]);

    const summary = await importDocumentsFromPath(join(root, "skip.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
      importPolicy: "skip_existing",
    });

    expect(summary.skippedChunks).toBe(1);
    expect(summary.skipReasons.already_exists).toBe(1);
  });

  it("triggers onImportStarted once at first real write milestone", async () => {
    writeFileSync(join(root, "started.txt"), "first\nsecond\nthird\n");
    const onImportStarted = jest.fn<Promise<void>, []>().mockResolvedValue();

    await importDocumentsFromPath(join(root, "started.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
      onImportStarted,
    });

    expect(onImportStarted).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onImportStarted when interrupted before real work starts", async () => {
    writeFileSync(join(root, "prestart-interrupt.txt"), "first\nsecond\nthird\n");
    const onImportStarted = jest.fn<Promise<void>, []>().mockResolvedValue();
    mockEnsureEmbeddingModelAvailable.mockRejectedValueOnce(new ImportInterruptedError());

    await expect(
      importDocumentsFromPath(join(root, "prestart-interrupt.txt"), {
        project: "MemoryMesh",
        dryRun: false,
        homeDir,
        onImportStarted,
      })
    ).rejects.toBeInstanceOf(ImportInterruptedError);

    expect(onImportStarted).not.toHaveBeenCalled();
  });

  it("renders GPT-style three-line progress contract during document import", async () => {
    writeFileSync(join(root, "progress.txt"), "first\nsecond\nthird\nfourth\n");
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await importDocumentsFromPath(join(root, "progress.txt"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    const written = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    stdoutSpy.mockRestore();

    expect(written).toContain("[overall ]");
    expect(written).toContain("[file    ]");
    expect(written).toContain("[chunk   ]");
  });

  it("shows active file in progress frame and emits one completion line per file", async () => {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "alpha.txt"), "alpha line one\nalpha line two\n");
    writeFileSync(join(root, "docs", "beta.md"), "# beta\nbeta line one\nbeta line two\n");
    const stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await importDocumentsFromPath(join(root, "docs"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    const written = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    stdoutSpy.mockRestore();
    logSpy.mockRestore();

    expect(written).toContain("alpha.txt");
    expect(written).toContain("beta.md");
    expect(logged.some((line) => line.includes("chunk(s) pending"))).toBe(false);
    const completedAlpha = logged.filter((line) =>
      line.includes("[document-import] completed file")
      && line.includes("alpha.txt")
    );
    const completedBeta = logged.filter((line) =>
      line.includes("[document-import] completed file")
      && line.includes("beta.md")
    );
    expect(completedAlpha).toHaveLength(1);
    expect(completedBeta).toHaveLength(1);
  });

  it("imports normally for overwrite_existing when there is no existing match", async () => {
    writeFileSync(join(root, "overwrite-new.txt"), "first\nsecond\n");

    const summary = await importDocumentsFromPath(join(root, "overwrite-new.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
      importPolicy: "overwrite_existing",
    });

    expect(summary.importedChunks).toBeGreaterThan(0);
    expect(summary.skippedChunks).toBe(0);
    expect(summary.skipReasons.overwrite_existing_not_supported).toBeUndefined();
    expect(mockSaveMemory).toHaveBeenCalled();
  });

  it("replaces existing matches for overwrite_existing", async () => {
    writeFileSync(join(root, "overwrite-existing.txt"), "first\nsecond\n");
    mockGetMemoryByRef
      .mockResolvedValueOnce([{ id: "old-1" }])
      .mockResolvedValueOnce([]);

    const summary = await importDocumentsFromPath(join(root, "overwrite-existing.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
      importPolicy: "overwrite_existing",
    });

    expect(summary.importedChunks).toBeGreaterThan(0);
    expect(summary.skippedChunks).toBe(0);
    expect(summary.skipReasons.overwrite_existing_not_supported).toBeUndefined();
    expect(mockDeleteMemoriesByIds).toHaveBeenCalledWith(["old-1"]);
    expect(mockSaveMemory).toHaveBeenCalled();
    const overwritePayload = mockSaveMemory.mock.calls[0][0] as {
      source_metadata: { source_extension: string; filename: string };
    };
    expect(overwritePayload.source_metadata.filename).toBe("overwrite-existing.txt");
    expect(overwritePayload.source_metadata.source_extension).toBe("txt");
  });

  it("imports even when a match exists for import_anyway", async () => {
    writeFileSync(join(root, "import-anyway.txt"), "first\nsecond\n");
    mockGetMemoryByRef.mockResolvedValue([{ id: "existing-1" }]);

    const summary = await importDocumentsFromPath(join(root, "import-anyway.txt"), {
      project: "MemoryMesh",
      dryRun: false,
      homeDir,
      importPolicy: "import_anyway",
    });

    expect(summary.importedChunks).toBeGreaterThan(0);
    expect(summary.skippedChunks).toBe(0);
    expect(summary.skipReasons.already_exists).toBeUndefined();
    expect(mockSaveMemory).toHaveBeenCalled();
  });

  it("writes checkpoint file for document imports", async () => {
    process.env.MEMORYMESH_CHECKPOINT_DIR = join(root, "checkpoints");
    writeFileSync(join(root, "checkpoint.txt"), "abc def ghi jkl");

    const summary = await importDocumentsFromPath(join(root, "checkpoint.txt"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.checkpointPath).toBeDefined();
    expect(summary.checkpointPath).toContain("document-import-dry-run-");
    const raw = readFileSync(summary.checkpointPath as string, "utf8");
    expect(raw).toContain("files");

    delete process.env.MEMORYMESH_CHECKPOINT_DIR;
  });

  it("does not reuse checkpoint across embedding model change", async () => {
    process.env.MEMORYMESH_CHECKPOINT_DIR = join(root, "checkpoints");
    writeFileSync(join(root, "embed-shift.txt"), "first\nsecond\nthird\n");
    const inputPath = join(root, "embed-shift.txt");

    const first = await importDocumentsFromPath(inputPath, {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
      runtimeEnv: {
        EMBEDDING_MODEL: "nomic-embed-text",
        MEMORYMESH_EMBEDDING_MODE: "flash",
        MEMORYMESH_EMBEDDING_DIMENSION: "768",
      },
    });
    const second = await importDocumentsFromPath(inputPath, {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
      runtimeEnv: {
        EMBEDDING_MODEL: "mxbai-embed-large",
        MEMORYMESH_EMBEDDING_MODE: "medium",
        MEMORYMESH_EMBEDDING_DIMENSION: "1024",
      },
    });

    expect(first.checkpointPath).toContain("document-import-dry-run-");
    expect(second.checkpointPath).toContain("document-import-dry-run-");
    expect(first.checkpointPath).not.toBe(second.checkpointPath);
    expect(second.resumed).toBe(false);
    expect(second.importedChunks).toBeGreaterThan(0);

    delete process.env.MEMORYMESH_CHECKPOINT_DIR;
  });

  it("uses rust-backed parser output when provided", async () => {
    const parseWithRust = jest.fn(async () => ({
      scan_summary: {
        discovered_files: 1,
        supported_files: 1,
        skipped_files: 0,
      },
      files: [
        {
          path: join(root, "rust.txt"),
          relative_path: "rust.txt",
          extension: ".txt",
          size_bytes: 12,
          status: "supported" as const,
          reason: "parsed",
          chunks: [
            {
              content: "from rust",
              chunk_index: 0,
              chunk_total: 1,
            },
          ],
        },
      ],
    }));

    const summary = await importDocumentsFromPath(
      join(root, "rust.txt"),
      {
        project: "MemoryMesh",
        dryRun: true,
        homeDir,
      },
      {
        parseWithRust,
      }
    );

    expect(parseWithRust).toHaveBeenCalledTimes(1);
    expect(summary.discoveredFiles).toBe(1);
    expect(summary.importedChunks).toBe(1);
  });

  it("keeps runtime env active until background save drain completes, then restores", async () => {
    writeFileSync(join(root, "env-lifetime.txt"), "alpha\nbeta\n");
    const previousModel = process.env.EMBEDDING_MODEL;
    const previousMode = process.env.MEMORYMESH_EMBEDDING_MODE;
    const previousDimension = process.env.MEMORYMESH_EMBEDDING_DIMENSION;
    process.env.EMBEDDING_MODEL = "ambient-model";
    process.env.MEMORYMESH_EMBEDDING_MODE = "ambient";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "111";

    let modelSeenDuringSave: string | undefined;
    let modelSeenDuringDrain: string | undefined;
    mockSaveMemory.mockImplementation(async () => {
      modelSeenDuringSave = process.env.EMBEDDING_MODEL;
    });
    mockWaitForBackgroundSaveTasks.mockImplementation(async () => {
      modelSeenDuringDrain = process.env.EMBEDDING_MODEL;
    });

    try {
      await importDocumentsFromPath(join(root, "env-lifetime.txt"), {
        project: "MemoryMesh",
        dryRun: false,
        homeDir,
        runtimeEnv: {
          EMBEDDING_MODEL: "runtime-model",
          MEMORYMESH_EMBEDDING_MODE: "flash",
          MEMORYMESH_EMBEDDING_DIMENSION: "768",
        },
      });

      expect(modelSeenDuringSave).toBe("runtime-model");
      expect(modelSeenDuringDrain).toBe("runtime-model");
      expect(process.env.EMBEDDING_MODEL).toBe("ambient-model");
      expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("ambient");
      expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("111");
    } finally {
      if (previousModel === undefined) {
        delete process.env.EMBEDDING_MODEL;
      } else {
        process.env.EMBEDDING_MODEL = previousModel;
      }
      if (previousMode === undefined) {
        delete process.env.MEMORYMESH_EMBEDDING_MODE;
      } else {
        process.env.MEMORYMESH_EMBEDDING_MODE = previousMode;
      }
      if (previousDimension === undefined) {
        delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
      } else {
        process.env.MEMORYMESH_EMBEDDING_DIMENSION = previousDimension;
      }
    }
  });
});
