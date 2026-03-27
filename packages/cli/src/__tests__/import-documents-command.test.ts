import { ImportInterruptedError } from "@memorymesh/core";
import {
  persistLastStartedDocumentImportPath,
  readLastStartedDocumentImportPath,
} from "../commands/import-defaults";
import {
  parseImportDocumentsArgs,
  runImportDocumentsCommand,
} from "../commands/import-documents";

jest.mock("../commands/import-defaults", () => ({
  persistLastStartedDocumentImportPath: jest.fn(),
  readLastStartedDocumentImportPath: jest.fn(),
}));

const mockedPersistLastStartedDocumentImportPath =
  persistLastStartedDocumentImportPath as jest.MockedFunction<
    typeof persistLastStartedDocumentImportPath
  >;
const mockedReadLastStartedDocumentImportPath =
  readLastStartedDocumentImportPath as jest.MockedFunction<
    typeof readLastStartedDocumentImportPath
  >;

describe("import-documents command", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadLastStartedDocumentImportPath.mockResolvedValue(null);
  });

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
    const importer = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        return {
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
        };
      }
    );
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
    expect(mockedPersistLastStartedDocumentImportPath).toHaveBeenCalledWith(
      expect.any(String),
      "/tmp/docs"
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
    expect(mockedPersistLastStartedDocumentImportPath).not.toHaveBeenCalled();
  });

  it("persists last path when interrupted after real start milestone", async () => {
    const importer = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        throw new ImportInterruptedError();
      }
    );
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
    expect(mockedPersistLastStartedDocumentImportPath).toHaveBeenCalledWith(
      expect.any(String),
      "/tmp/docs"
    );
  });

  it("fails on invalid import policy value", async () => {
    const importer = jest.fn();
    const code = await runImportDocumentsCommand(
      ["--path", "/tmp/docs", "--import-policy", "bad_policy"],
      {
        importer,
        logger: { log: jest.fn(), error: jest.fn() },
        resolveEmbeddingAuthority: jest.fn(),
      }
    );

    expect(code).toBe(1);
    expect(importer).not.toHaveBeenCalled();
    expect(mockedPersistLastStartedDocumentImportPath).not.toHaveBeenCalled();
  });

  it("allows overwrite_existing policy and runs importer", async () => {
    const importer = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        return {
          inputPath: "/tmp/docs",
          discoveredFiles: 1,
          supportedFiles: 1,
          skippedFiles: 0,
          importedChunks: 1,
          skippedChunks: 0,
          skipReasons: {},
          checkpointUsed: true,
          resumed: false,
          checkpointPath: "/tmp/checkpoint.json",
          checkpointMode: "real" as const,
          auditLogPath: "/tmp/audit.jsonl",
        };
      }
    );
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
    const code = await runImportDocumentsCommand(
      ["--path", "/tmp/docs", "--import-policy", "overwrite_existing"],
      {
        importer,
        logger: { log: jest.fn(), error: jest.fn() },
        resolveEmbeddingAuthority,
      }
    );

    expect(code).toBe(0);
    expect(importer).toHaveBeenCalledWith(
      "/tmp/docs",
      expect.objectContaining({
        importPolicy: "overwrite_existing",
      })
    );
    expect(mockedPersistLastStartedDocumentImportPath).toHaveBeenCalledWith(
      expect.any(String),
      "/tmp/docs"
    );
  });

  it("invokes onImportSuccess callback after successful import", async () => {
    const importer = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        return {
          inputPath: "/tmp/docs",
          discoveredFiles: 1,
          supportedFiles: 1,
          skippedFiles: 0,
          importedChunks: 1,
          skippedChunks: 0,
          skipReasons: {},
          checkpointUsed: true,
          resumed: false,
          checkpointPath: "/tmp/checkpoint.json",
          checkpointMode: "real" as const,
          auditLogPath: "/tmp/audit.jsonl",
        };
      }
    );
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
    const onImportSuccess = jest.fn<Promise<void>, [string]>().mockResolvedValue();

    const code = await runImportDocumentsCommand(["--path", "/tmp/docs"], {
      importer,
      resolveEmbeddingAuthority,
      logger: { log: jest.fn(), error: jest.fn() },
      onImportSuccess,
    });

    expect(code).toBe(0);
    expect(onImportSuccess).toHaveBeenCalledWith("/tmp/docs");
  });

  it("falls back to stored last path in direct mode when --path is omitted", async () => {
    mockedReadLastStartedDocumentImportPath.mockResolvedValue("/tmp/stored-docs");
    const importer = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        return {
          inputPath: "/tmp/stored-docs",
          discoveredFiles: 1,
          supportedFiles: 1,
          skippedFiles: 0,
          importedChunks: 1,
          skippedChunks: 0,
          skipReasons: {},
          checkpointUsed: true,
          resumed: false,
          checkpointPath: "/tmp/checkpoint.json",
          checkpointMode: "real" as const,
          auditLogPath: "/tmp/audit.jsonl",
        };
      }
    );
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

    const code = await runImportDocumentsCommand([], {
      importer,
      resolveEmbeddingAuthority,
      logger: { log: jest.fn(), error: jest.fn() },
      readLastDocumentImportPath: async () => "/tmp/stored-docs",
      pathExists: () => true,
    });

    expect(code).toBe(0);
    expect(importer).toHaveBeenCalledWith(
      "/tmp/stored-docs",
      expect.any(Object)
    );
  });

  it("fails when stored fallback path is missing on filesystem", async () => {
    const logger = { log: jest.fn<void, [string]>(), error: jest.fn<void, [string]>() };

    const code = await runImportDocumentsCommand([], {
      importer: jest.fn(),
      resolveEmbeddingAuthority: jest.fn(),
      logger,
      readLastDocumentImportPath: async () => "/tmp/missing-docs",
      pathExists: () => false,
    });

    expect(code).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("Missing required --path argument.");
  });

  it("uses newly remembered path on next run after interrupted-after-start import", async () => {
    let rememberedPath: string | null = null;
    mockedPersistLastStartedDocumentImportPath.mockImplementation(
      async (_homeDir: string, inputPath: string) => {
        rememberedPath = inputPath;
      }
    );
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
    const interruptedImporter = jest.fn(
      async (
        _inputPath: string,
        options: {
          onImportStarted?: () => Promise<void> | void;
        }
      ) => {
        await options.onImportStarted?.();
        throw new ImportInterruptedError();
      }
    );
    const resumedImporter = jest.fn(async () => ({
      inputPath: "/tmp/new-docs",
      discoveredFiles: 1,
      supportedFiles: 1,
      skippedFiles: 0,
      importedChunks: 1,
      skippedChunks: 0,
      skipReasons: {},
      checkpointUsed: true,
      resumed: true,
      checkpointPath: "/tmp/checkpoint.json",
      checkpointMode: "real" as const,
      auditLogPath: "/tmp/audit.jsonl",
    }));

    const interruptedCode = await runImportDocumentsCommand(["--path", "/tmp/new-docs"], {
      importer: interruptedImporter,
      resolveEmbeddingAuthority,
      logger: { log: jest.fn(), error: jest.fn() },
    });
    expect(interruptedCode).toBe(130);
    expect(rememberedPath).toBe("/tmp/new-docs");

    const resumedCode = await runImportDocumentsCommand([], {
      importer: resumedImporter,
      resolveEmbeddingAuthority,
      logger: { log: jest.fn(), error: jest.fn() },
      readLastDocumentImportPath: async () => rememberedPath,
      pathExists: () => true,
    });

    expect(resumedCode).toBe(0);
    expect(resumedImporter).toHaveBeenCalledWith("/tmp/new-docs", expect.any(Object));
  });
});
