import { ImportInterruptedError } from "@memorymesh/core";
import {
  parseImportDocumentsArgs,
  runImportDocumentsCommand,
} from "../commands/import-documents";

describe("import-documents command", () => {
  it("parses args", () => {
    const parsed = parseImportDocumentsArgs([
      "--path",
      "/tmp/docs",
      "--project",
      "Research",
      "--import-policy",
      "import_anyway",
      "--dry-run",
      "--no-checkpoint",
      "--reset-checkpoint",
    ]);

    expect(parsed).toEqual({
      path: "/tmp/docs",
      project: "Research",
      importPolicy: "import_anyway",
      dryRun: true,
      checkpoint: false,
      resetCheckpoint: true,
      help: false,
    });
  });

  it("runs importer and returns 0", async () => {
    const importer = jest.fn(async () => ({
      inputPath: "/tmp/docs",
      discoveredFiles: 3,
      supportedFiles: 2,
      skippedFiles: 1,
      importedChunks: 4,
      skippedChunks: 0,
      skipReasons: {},
      checkpointUsed: true,
      resumed: false,
      checkpointPath: "/tmp/checkpoint.json",
      checkpointMode: "real" as const,
      auditLogPath: "/tmp/audit.jsonl",
    }));
    const resolveEmbeddingAuthority = jest.fn(async () => ({
      config: {
        installState: "installed" as const,
        embeddingMode: "flash" as const,
        embeddingModel: "nomic-embed-text" as const,
        embeddingDimension: 768,
        installedAt: "2026-03-26T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
        stackMode: "release-image" as const,
      },
      embedding: {
        embeddingMode: "flash" as const,
        embeddingModel: "nomic-embed-text" as const,
        embeddingDimension: 768,
      },
      runtimeEnv: {
        EMBEDDING_MODEL: "nomic-embed-text",
        MEMORYMESH_EMBEDDING_MODE: "flash",
        MEMORYMESH_EMBEDDING_DIMENSION: "768",
      },
      runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
      runtimeEnvRegenerated: false,
    }));
    const logger = {
      log: jest.fn<void, [string]>(),
      error: jest.fn<void, [string]>(),
    };

    const code = await runImportDocumentsCommand(
      ["--path", "/tmp/docs", "--project", "MemoryMesh"],
      {
        importer,
        resolveEmbeddingAuthority,
        logger,
      }
    );

    expect(code).toBe(0);
    expect(importer).toHaveBeenCalledWith(
      "/tmp/docs",
      expect.objectContaining({
        project: "MemoryMesh",
        importPolicy: "skip_existing",
        checkpointEnabled: true,
        resetCheckpoint: false,
      })
    );
  });

  it("returns 130 on interruption", async () => {
    const importer = jest.fn(async () => {
      throw new ImportInterruptedError();
    });
    const resolveEmbeddingAuthority = jest.fn(async () => ({
      config: {
        installState: "installed" as const,
        embeddingMode: "flash" as const,
        embeddingModel: "nomic-embed-text" as const,
        embeddingDimension: 768,
        installedAt: "2026-03-26T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
      },
      embedding: {
        embeddingMode: "flash" as const,
        embeddingModel: "nomic-embed-text" as const,
        embeddingDimension: 768,
      },
      runtimeEnv: {
        EMBEDDING_MODEL: "nomic-embed-text",
        MEMORYMESH_EMBEDDING_MODE: "flash",
        MEMORYMESH_EMBEDDING_DIMENSION: "768",
      },
      runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
      runtimeEnvRegenerated: false,
    }));

    const code = await runImportDocumentsCommand(["--path", "/tmp/docs"], {
      importer,
      resolveEmbeddingAuthority,
      logger: { log: jest.fn(), error: jest.fn() },
    });

    expect(code).toBe(130);
  });
});
