import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImportInterruptedError } from "@memorymesh/core";
import { importDocumentsFromPath } from "../document-import";

const mockSaveMemory = jest.fn<Promise<void>, [unknown]>();
const mockGetMemoryByRef = jest.fn<Promise<Array<{ id: string }>>, [string, string | undefined]>();
const mockEnsureEmbeddingModelAvailable = jest.fn<Promise<void>, []>();
const mockWaitForBackgroundSaveTasks = jest.fn<Promise<void>, []>();

jest.mock("@memorymesh/runtime", () => ({
  createRuntimeImporterGateway: () => ({
    saveMemory: (input: unknown) => mockSaveMemory(input),
    getMemoryByRef: (refId: string, project?: string) => mockGetMemoryByRef(refId, project),
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
    };
    expect(payload.source_format).toBe("document_import_v1");
    expect(payload.source_type).toBe("document");
    expect(payload.content).toContain("source_path:");
    expect(payload.content).toContain("chunk_index:");
    expect(payload.tags).toEqual(expect.arrayContaining(["document-import"]));
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

  it("writes checkpoint file for document imports", async () => {
    process.env.MEMORYMESH_CHECKPOINT_DIR = join(root, "checkpoints");
    writeFileSync(join(root, "checkpoint.txt"), "abc def ghi jkl");

    const summary = await importDocumentsFromPath(join(root, "checkpoint.txt"), {
      project: "MemoryMesh",
      dryRun: true,
      homeDir,
    });

    expect(summary.checkpointPath).toBeDefined();
    const raw = readFileSync(summary.checkpointPath as string, "utf8");
    expect(raw).toContain("files");

    delete process.env.MEMORYMESH_CHECKPOINT_DIR;
  });
});
