import {
  parseImportGptArgs,
  runImportGptCommand,
} from "../commands/import-gpt";

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
    });

    expect(code).toBe(0);
    expect(importer).toHaveBeenCalled();
  });
});
