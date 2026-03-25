import {
  parseImportGptArgs,
  runImportGptCommand,
} from "../commands/import-gpt";
import { ICommandRunner, ICommandRunOptions, ICommandResult } from "../system/command-runner";

class FakeRunner implements ICommandRunner {
  calls: string[] = [];
  constructor(
    private readonly qdrantCollectionDimension: number | null = null
  ) {}

  async run(
    command: string,
    args: string[] = [],
    _options?: ICommandRunOptions
  ): Promise<ICommandResult> {
    const key = `${command} ${args.join(" ")}`;
    this.calls.push(key);

    if (key === "curl -fsS http://localhost:6333/collections/memories") {
      if (!this.qdrantCollectionDimension) {
        return {
          stdout: "",
          stderr: "not found",
          exitCode: 1,
          success: false,
        };
      }
      return {
        stdout: JSON.stringify({
          result: {
            config: {
              params: {
                vectors: { size: this.qdrantCollectionDimension },
              },
            },
          },
        }),
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    return {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      success: true,
    };
  }
}

describe("import-gpt command", () => {
  it("uses documented defaults when optional flags are not provided", () => {
    const args = parseImportGptArgs(["--path", "/tmp/export"]);
    expect(args.project).toBe("MemoryMesh");
    expect(args.engine).toBe("ts");
    expect(args.importPolicy).toBe("skip_existing");
    expect(args.verbose).toBe(false);
    expect(args.delayMs).toBe(0);
    expect(args.dryRun).toBe(false);
    expect(args.checkpoint).toBe(true);
    expect(args.resetCheckpoint).toBe(false);
  });

  it("parses direct command arguments", () => {
    const args = parseImportGptArgs([
      "--path",
      "/tmp/export",
      "--project",
      "MemoryMesh",
      "--dry-run",
      "--engine",
      "rust",
      "--verbose",
      "--import-policy",
      "skip_existing",
      "--delay-ms",
      "0",
      "--limit",
      "5",
      "--no-checkpoint",
      "--reset-checkpoint",
    ]);

    expect(args.path).toBe("/tmp/export");
    expect(args.project).toBe("MemoryMesh");
    expect(args.dryRun).toBe(true);
    expect(args.engine).toBe("rust");
    expect(args.verbose).toBe(true);
    expect(args.importPolicy).toBe("skip_existing");
    expect(args.delayMs).toBe(0);
    expect(args.limit).toBe(5);
    expect(args.checkpoint).toBe(false);
    expect(args.resetCheckpoint).toBe(true);
  });

  it("prints help and returns 1 when path is missing", async () => {
    const log = jest.fn();
    const error = jest.fn();
    const code = await runImportGptCommand([], {
      logger: { log, error },
    });

    expect(code).toBe(1);
    expect(log).toHaveBeenCalled();
    const helpOutput = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(helpOutput).toContain("MemoryMesh Import Command");
    expect(helpOutput).toContain("Usage:");
    expect(helpOutput).toContain("Options:");
    expect(helpOutput).toContain("Defaults:");
    expect(helpOutput).toContain("Interactive mode defaults:");
    expect(helpOutput).toContain("Mode: real import (default)");
    expect(helpOutput).toContain("MEMORYMESH_INTERACTIVE_DRY_RUN=true");
    expect(helpOutput).toContain("Import policy behavior:");
    expect(helpOutput).toContain("Output behavior:");
    expect(helpOutput).toContain("Examples:");
  });

  it("routes to importer and returns 0 on success", async () => {
    const importer = jest.fn(async () => ({
      scannedJsonFiles: 1,
      supportedConversationFiles: 1,
      importedConversations: 1,
      savedMemories: 1,
      skippedMemories: 0,
      categories: {
        supported_conversation_file: 1,
        unsupported_conversation_schema: 0,
        ignorable_json: 0,
        unknown_json: 0,
        invalid_json: 0,
      },
      skipReasons: {},
      checkpointUsed: true,
      resumed: false,
      checkpointPath: "/tmp/checkpoint.json",
      checkpointMode: "real" as const,
      resumeSkippedMessages: 0,
    }));
    const code = await runImportGptCommand(["--path", "/tmp/export"], {
      importer,
      resolveEmbeddingAuthority: async () => ({
        config: {
          embeddingMode: "flash",
          embeddingModel: "nomic-embed-text",
          embeddingDimension: 768,
        } as any,
        embedding: {
          embeddingMode: "flash",
          embeddingModel: "nomic-embed-text",
          embeddingDimension: 768,
        },
        runtimeEnv: {
          EMBEDDING_MODEL: "nomic-embed-text",
          MEMORYMESH_EMBEDDING_MODE: "flash",
          MEMORYMESH_EMBEDDING_DIMENSION: "768",
        },
        runtimeEnvPath: "/tmp/runtime.env",
        runtimeEnvRegenerated: false,
      }),
      runner: {
        run: async () => ({
          stdout: "",
          stderr: "not found",
          exitCode: 1,
          success: false,
        }),
      },
    });

    expect(code).toBe(0);
    expect(importer).toHaveBeenCalled();
  });

  it("passes persisted installer embedding config to import execution", async () => {
    const previousModel = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = "should-be-overridden";
    try {
      const importer = jest.fn(async (_inputPath, options) => {
        expect(options.runtimeEnv?.EMBEDDING_MODEL).toBe("mxbai-embed-large");
        expect(options.runtimeEnv?.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
        expect(options.runtimeEnv?.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
        return {
          scannedJsonFiles: 1,
          supportedConversationFiles: 1,
          importedConversations: 1,
          savedMemories: 1,
          skippedMemories: 0,
          categories: {
            supported_conversation_file: 1,
            unsupported_conversation_schema: 0,
            ignorable_json: 0,
            unknown_json: 0,
            invalid_json: 0,
          },
          skipReasons: {},
          checkpointUsed: true,
          resumed: false,
          checkpointPath: "/tmp/checkpoint.json",
          checkpointMode: "real" as const,
          resumeSkippedMessages: 0,
        };
      });

      const code = await runImportGptCommand(["--path", "/tmp/export"], {
        importer,
        runner: new FakeRunner(null),
        resolveEmbeddingAuthority: async () => ({
          config: {
            installState: "installed",
            embeddingMode: "medium",
            embeddingModel: "mxbai-embed-large",
            embeddingDimension: 1024,
            installedAt: "2026-03-24T00:00:00.000Z",
            stackProjectDir: "/tmp/home/.memorymesh/stack",
            composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
            stackMode: "release-image",
          },
          embedding: {
            embeddingMode: "medium",
            embeddingModel: "mxbai-embed-large",
            embeddingDimension: 1024,
          },
          runtimeEnv: {
            EMBEDDING_MODEL: "mxbai-embed-large",
            MEMORYMESH_EMBEDDING_MODE: "medium",
            MEMORYMESH_EMBEDDING_DIMENSION: "1024",
          },
          runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
          runtimeEnvRegenerated: false,
        }),
      });

      expect(code).toBe(0);
      expect(importer).toHaveBeenCalled();
      expect(process.env.EMBEDDING_MODEL).toBe("should-be-overridden");
    } finally {
      if (previousModel === undefined) {
        delete process.env.EMBEDDING_MODEL;
      } else {
        process.env.EMBEDDING_MODEL = previousModel;
      }
      delete process.env.MEMORYMESH_EMBEDDING_MODE;
      delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
    }
  });

  it("hard-fails before import when embedding dimensions mismatch", async () => {
    const runner = new FakeRunner(768);
    const importer = jest.fn();
    const logger = { log: jest.fn(), error: jest.fn() };

    const code = await runImportGptCommand(["--path", "/tmp/export"], {
      importer,
      runner,
      resolveEmbeddingAuthority: async () => ({
        config: {
          installState: "installed",
          embeddingMode: "medium",
          embeddingModel: "mxbai-embed-large",
          embeddingDimension: 1024,
          installedAt: "2026-03-24T00:00:00.000Z",
          stackProjectDir: "/tmp/home/.memorymesh/stack",
          composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
          stackMode: "release-image",
        },
        embedding: {
          embeddingMode: "medium",
          embeddingModel: "mxbai-embed-large",
          embeddingDimension: 1024,
        },
        runtimeEnv: {
          EMBEDDING_MODEL: "mxbai-embed-large",
          MEMORYMESH_EMBEDDING_MODE: "medium",
          MEMORYMESH_EMBEDDING_DIMENSION: "1024",
        },
        runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
        runtimeEnvRegenerated: false,
      }),
      logger,
    });

    expect(code).toBe(1);
    expect(importer).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Embedding mismatch detected")
    );
  });

  it("logs resolved installer embedding config when engine=rust", async () => {
    const importer = jest.fn(async () => ({
      scannedJsonFiles: 1,
      supportedConversationFiles: 1,
      importedConversations: 1,
      savedMemories: 1,
      skippedMemories: 0,
      categories: {
        supported_conversation_file: 1,
        unsupported_conversation_schema: 0,
        ignorable_json: 0,
        unknown_json: 0,
        invalid_json: 0,
      },
      skipReasons: {},
      checkpointUsed: true,
      resumed: false,
      checkpointPath: "/tmp/checkpoint.json",
      checkpointMode: "real" as const,
      resumeSkippedMessages: 0,
    }));
    const logger = { log: jest.fn(), error: jest.fn() };

    const code = await runImportGptCommand(
      ["--path", "/tmp/export", "--engine", "rust"],
      {
        importer,
        runner: new FakeRunner(null),
        resolveEmbeddingAuthority: async () => ({
          config: {
            installState: "installed",
            embeddingMode: "medium",
            embeddingModel: "mxbai-embed-large",
            embeddingDimension: 1024,
            installedAt: "2026-03-24T00:00:00.000Z",
            stackProjectDir: "/tmp/home/.memorymesh/stack",
            composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
            stackMode: "release-image",
          },
          embedding: {
            embeddingMode: "medium",
            embeddingModel: "mxbai-embed-large",
            embeddingDimension: 1024,
          },
          runtimeEnv: {
            EMBEDDING_MODEL: "mxbai-embed-large",
            MEMORYMESH_EMBEDDING_MODE: "medium",
            MEMORYMESH_EMBEDDING_DIMENSION: "1024",
          },
          runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
          runtimeEnvRegenerated: false,
        }),
        logger,
      }
    );

    expect(code).toBe(0);
    expect(logger.log).toHaveBeenCalledWith(
      "Rust import embedding model resolved: mxbai-embed-large"
    );
    expect(logger.log).toHaveBeenCalledWith(
      "Rust import embedding dimension resolved: 1024"
    );
    expect(logger.log).toHaveBeenCalledWith(
      "Rust import embedding mode resolved: medium"
    );
    expect(logger.log).toHaveBeenCalledWith("Source: installer runtime config");
  });

  it("does not call onImportStarted when importer fails before real start milestone", async () => {
    const onImportStarted = jest.fn();
    const importer = jest.fn(async () => {
      throw new Error("validation failed before import start");
    });

    const code = await runImportGptCommand(["--path", "/tmp/export"], {
      importer,
      onImportStarted,
      runner: new FakeRunner(null),
      resolveEmbeddingAuthority: async () => ({
        config: {
          installState: "installed",
          embeddingMode: "flash",
          embeddingModel: "nomic-embed-text",
          embeddingDimension: 768,
          installedAt: "2026-03-24T00:00:00.000Z",
          stackProjectDir: "/tmp/home/.memorymesh/stack",
          composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
          stackMode: "release-image",
        },
        embedding: {
          embeddingMode: "flash",
          embeddingModel: "nomic-embed-text",
          embeddingDimension: 768,
        },
        runtimeEnv: {
          EMBEDDING_MODEL: "nomic-embed-text",
          MEMORYMESH_EMBEDDING_MODE: "flash",
          MEMORYMESH_EMBEDDING_DIMENSION: "768",
        },
        runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
        runtimeEnvRegenerated: false,
      }),
    });

    expect(code).toBe(1);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(onImportStarted).not.toHaveBeenCalled();
  });

  it("passes onImportStarted to importer for real start milestone trigger", async () => {
    const onImportStarted = jest.fn();
    const importer = jest.fn(async (_inputPath, options) => {
      await options.onImportStarted?.();
      return {
        scannedJsonFiles: 1,
        supportedConversationFiles: 1,
        importedConversations: 1,
        savedMemories: 1,
        skippedMemories: 0,
        categories: {
          supported_conversation_file: 1,
          unsupported_conversation_schema: 0,
          ignorable_json: 0,
          unknown_json: 0,
          invalid_json: 0,
        },
        skipReasons: {},
        checkpointUsed: true,
        resumed: false,
        checkpointPath: "/tmp/checkpoint.json",
        checkpointMode: "real" as const,
        resumeSkippedMessages: 0,
      };
    });

    const code = await runImportGptCommand(["--path", "/tmp/export"], {
      importer,
      onImportStarted,
      runner: new FakeRunner(null),
      resolveEmbeddingAuthority: async () => ({
        config: {
          installState: "installed",
          embeddingMode: "medium",
          embeddingModel: "mxbai-embed-large",
          embeddingDimension: 1024,
          installedAt: "2026-03-24T00:00:00.000Z",
          stackProjectDir: "/tmp/home/.memorymesh/stack",
          composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
          stackMode: "release-image",
        },
        embedding: {
          embeddingMode: "medium",
          embeddingModel: "mxbai-embed-large",
          embeddingDimension: 1024,
        },
        runtimeEnv: {
          EMBEDDING_MODEL: "mxbai-embed-large",
          MEMORYMESH_EMBEDDING_MODE: "medium",
          MEMORYMESH_EMBEDDING_DIMENSION: "1024",
        },
        runtimeEnvPath: "/tmp/home/.memorymesh/runtime.env",
        runtimeEnvRegenerated: false,
      }),
    });

    expect(code).toBe(0);
    expect(onImportStarted).toHaveBeenCalledTimes(1);
  });
});
