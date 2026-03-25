import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImportInterruptedError } from "@memorymesh/core";
import { importFromPath } from "../folder-import";
import { IRustEngineOutput } from "../rust-engine";
import { IScanReport } from "../folder-scan";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("folder-import", () => {
  let root: string;
  let checkpointRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memorymesh-cli-import-"));
    checkpointRoot = mkdtempSync(join(tmpdir(), "memorymesh-cli-checkpoint-"));
    process.env.MEMORYMESH_CHECKPOINT_DIR = checkpointRoot;
    process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED = "false";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MEMORYMESH_CHECKPOINT_DIR;
    delete process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED;
    delete process.env.MEMORYMESH_IMPORT_AUDIT_DIR;
    delete process.env.MEMORYMESH_IMPORT_DEBUG_STOP_AFTER_MESSAGES;
    rmSync(root, { recursive: true, force: true });
    rmSync(checkpointRoot, { recursive: true, force: true });
  });

  it("routes only supported conversation files into importer and summarizes counts", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    writeFileSync(
      join(root, "group_chats.json"),
      JSON.stringify({ chats: [{ messages: [{ text: "hi" }] }] }),
      "utf-8"
    );
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ manifest: true }), "utf-8");
    writeFileSync(join(root, "unknown.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    writeFileSync(join(root, "broken.json"), "{broken", "utf-8");

    const parse = jest.fn(() => [
      { title: "c1", messages: [{ role: "assistant", content: "x" }] },
      { title: "c2", messages: [{ role: "assistant", content: "y" }] },
    ]);

    const importer = jest.fn(async () => ({
      totalConversations: 2,
      saved: 3,
      skipped: 1,
      skippedReasons: { duplicate_ref_id: 1 },
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: false,
        delayMs: 0,
      },
      { parse, importer }
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(summary.scannedJsonFiles).toBe(5);
    expect(summary.supportedConversationFiles).toBe(1);
    expect(summary.importedConversations).toBe(2);
    expect(summary.savedMemories).toBe(3);
    expect(summary.skippedMemories).toBe(1);
    expect(summary.categories.unsupported_conversation_schema).toBe(1);
    expect(summary.categories.ignorable_json).toBe(1);
    expect(summary.categories.unknown_json).toBe(1);
    expect(summary.categories.invalid_json).toBe(1);
    expect(summary.skipReasons.duplicate_ref_id).toBe(1);
    expect(summary.checkpointUsed).toBe(true);
    expect(summary.checkpointPath).toBeDefined();
    expect(summary.checkpointMode).toBe("real");
    expect(summary.resumed).toBe(false);
    const logs = logSpy.mock.calls.map((call) => String(call[0]));
    expect(logs[0]).toBe("Starting scan for GPT export files...");
    expect(logs[1]).toBe("Scan complete.");
    expect(logs).toContain("+---------------------------------+-------+");
    expect(logs).toContain("| Scanned JSON files              |     5 |");
    expect(logs).toContain("| Supported conversation files    |     1 |");
    expect(logs).toContain("| Unsupported conversation schema |     1 |");
    expect(logs).toContain("| Ignorable JSON                  |     1 |");
    expect(logs).toContain("| Unknown JSON                    |     1 |");
    expect(logs).toContain("| Invalid JSON                    |     1 |");
    expect(logs).toContain("");
    logSpy.mockRestore();
  });

  it("respects global conversation limit across supported files", async () => {
    writeFileSync(
      join(root, "supported-a.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    writeFileSync(
      join(root, "supported-b.json"),
      JSON.stringify([{ mapping: { b: {} }, current_node: "b" }]),
      "utf-8"
    );

    const parse = jest
      .fn()
      .mockReturnValueOnce([
        { title: "c1", messages: [{ role: "assistant", content: "x" }] },
      ])
      .mockReturnValueOnce([
        { title: "c2", messages: [{ role: "assistant", content: "y" }] },
      ]);

    const importer = jest.fn(async (conversations: unknown[]) => ({
      totalConversations: conversations.length,
      saved: conversations.length,
      skipped: 0,
      skippedReasons: {},
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        limit: 1,
      },
      { parse, importer }
    );

    expect(importer).toHaveBeenCalledTimes(1);
    expect(summary.importedConversations).toBe(1);
    expect(summary.savedMemories).toBe(1);
  });

  it("routes supported files from rust output into importer flow", async () => {
    const parse = jest.fn(() => []);
    const importer = jest.fn(async (conversations: unknown[]) => ({
      totalConversations: conversations.length,
      saved: conversations.length,
      skipped: 0,
      skippedReasons: {},
    }));
    const scanRust = jest.fn(async (): Promise<IRustEngineOutput> => ({
      scan_summary: {
        scanned_json_files: 3,
        supported_conversation_file: 1,
        unsupported_conversation_schema: 1,
        ignorable_json: 1,
        unknown_json: 0,
        invalid_json: 0,
      },
      files: [
        {
          path: "/tmp/conversations-001.json",
          category: "supported_conversation_file",
          reason: "array_with_mapping_and_current_node",
          conversations: [
            {
              title: "Conv R1",
              source_conversation_id: "r-1",
              messages: [{ role: "assistant", content: "hello" }],
            },
          ],
        },
        {
          path: "/tmp/group_chats.json",
          category: "unsupported_conversation_schema",
          reason: "group_chats_schema_not_supported_in_phase",
        },
        {
          path: "/tmp/user.json",
          category: "ignorable_json",
          reason: "metadata_or_support_json",
        },
      ],
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        engine: "rust",
      },
      { parse, importer, scanRust }
    );

    expect(scanRust).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(summary.scannedJsonFiles).toBe(3);
    expect(summary.supportedConversationFiles).toBe(1);
    expect(summary.importedConversations).toBe(1);
    expect(summary.savedMemories).toBe(1);
    expect(summary.categories.unsupported_conversation_schema).toBe(1);
    expect(summary.categories.ignorable_json).toBe(1);
  });

  it("applies authoritative runtime env to ts import and restores after success", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const parse = jest.fn(() => [
      { title: "c1", messages: [{ role: "assistant", content: "x" }] },
    ]);
    const importer = jest.fn(async () => {
      expect(process.env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
      expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
      expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });

    await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: false,
        delayMs: 0,
        runtimeEnv: {
          EMBEDDING_MODEL: "mxbai-embed-large",
          MEMORYMESH_EMBEDDING_MODE: "medium",
          MEMORYMESH_EMBEDDING_DIMENSION: "1024",
        },
      },
      { parse, importer }
    );

    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("restores previous env after ts import failure", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const parse = jest.fn(() => [
      { title: "c1", messages: [{ role: "assistant", content: "x" }] },
    ]);
    const importer = jest.fn(async () => {
      expect(process.env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
      expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
      expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
      throw new Error("import failed");
    });

    await expect(
      importFromPath(
        root,
        {
          project: "MemoryMesh",
          dryRun: false,
          delayMs: 0,
          runtimeEnv: {
            EMBEDDING_MODEL: "mxbai-embed-large",
            MEMORYMESH_EMBEDDING_MODE: "medium",
            MEMORYMESH_EMBEDDING_DIMENSION: "1024",
          },
        },
        { parse, importer }
      )
    ).rejects.toThrow("import failed");

    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("passes a cancellation token into ts importer and restores env after interruption", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const parse = jest.fn(() => [
      { title: "c1", messages: [{ role: "assistant", content: "x" }] },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      expect(options?.cancellationToken?.isCancelled).toBe(false);
      process.emit("SIGINT", "SIGINT");
      expect(options?.cancellationToken?.isCancelled).toBe(true);
      options?.cancellationToken?.throwIfCancelled();
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });

    await expect(
      importFromPath(
        root,
        {
          project: "MemoryMesh",
          dryRun: false,
          delayMs: 0,
          runtimeEnv: {
            EMBEDDING_MODEL: "mxbai-embed-large",
            MEMORYMESH_EMBEDDING_MODE: "medium",
            MEMORYMESH_EMBEDDING_DIMENSION: "1024",
          },
        },
        { parse, importer }
      )
    ).rejects.toBeInstanceOf(ImportInterruptedError);

    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("passes authoritative runtime env into rust scan path", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const parse = jest.fn(() => []);
    const importer = jest.fn(async () => ({
      totalConversations: 0,
      saved: 0,
      skipped: 0,
      skippedReasons: {},
    }));
    const scanRust = jest.fn(async (_inputPath: string, _binaryPath?: string, env?: NodeJS.ProcessEnv) => {
      expect(env?.EMBEDDING_MODEL).toBe("mxbai-embed-large");
      expect(env?.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
      expect(env?.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
      return {
        scan_summary: {
          scanned_json_files: 0,
          supported_conversation_file: 0,
          unsupported_conversation_schema: 0,
          ignorable_json: 0,
          unknown_json: 0,
          invalid_json: 0,
        },
        files: [],
      };
    });

    await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        engine: "rust",
        runtimeEnv: {
          EMBEDDING_MODEL: "mxbai-embed-large",
          MEMORYMESH_EMBEDDING_MODE: "medium",
          MEMORYMESH_EMBEDDING_DIMENSION: "1024",
        },
      },
      { parse, importer, scanRust }
    );

    expect(scanRust).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onImportStarted when no supported conversations are processed", async () => {
    const onImportStarted = jest.fn();
    const parse = jest.fn(() => []);
    const importer = jest.fn(async () => ({
      totalConversations: 0,
      saved: 0,
      skipped: 0,
      skippedReasons: {},
    }));

    await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        onImportStarted,
      },
      {
        parse,
        importer,
        scanRust: async (): Promise<IRustEngineOutput> => ({
          scan_summary: {
            scanned_json_files: 0,
            supported_conversation_file: 0,
            unsupported_conversation_schema: 0,
            ignorable_json: 0,
            unknown_json: 0,
            invalid_json: 0,
          },
          files: [],
        }),
      }
    );

    expect(onImportStarted).not.toHaveBeenCalled();
  });

  it("triggers onImportStarted exactly once when first conversation starts", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const onImportStarted = jest.fn();
    const parse = jest.fn(() => [
      {
        title: "Conv One",
        source_conversation_id: "conv-1",
        messages: [{ role: "assistant", content: "a" }],
      },
      {
        title: "Conv Two",
        source_conversation_id: "conv-2",
        messages: [{ role: "assistant", content: "b" }],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 2,
        title: "Conv One",
        message_count: 1,
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 2,
        title: "Conv One",
        saved: 1,
        skipped: 0,
      });
      options?.callbacks?.onConversationStart?.({
        conversation_index: 2,
        total_conversations: 2,
        title: "Conv Two",
        message_count: 1,
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 2,
        total_conversations: 2,
        title: "Conv Two",
        saved: 1,
        skipped: 0,
      });
      return {
        totalConversations: 2,
        saved: 2,
        skipped: 0,
        skippedReasons: {},
      };
    });

    await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: false,
        delayMs: 0,
        onImportStarted,
      },
      { parse, importer }
    );

    expect(onImportStarted).toHaveBeenCalledTimes(1);
  });

  it("creates checkpoint file and advances after safe message processing", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const parse = jest.fn(() => [
      {
        title: "Conv C",
        source_conversation_id: "conv-c",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
        ],
      },
    ]);

    const importer = jest.fn(async (conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv C",
        message_count: conversations[0].messages.length,
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv C",
        role: "assistant",
        message_index: 0,
        memory_type: "output",
        ref_id: "r1",
        preview: "m1",
      });
      options?.callbacks?.onMessageSkipped?.({
        conversation_title: "Conv C",
        role: "assistant",
        message_index: 1,
        reason: "duplicate_ref_id",
        ref_id: "r2",
        preview: "m2",
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv C",
        saved: 1,
        skipped: 1,
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 1,
        skippedReasons: { duplicate_ref_id: 1 },
      };
    });

    const summary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer }
    );

    expect(summary.checkpointPath).toBeDefined();
    const checkpointPath = summary.checkpointPath as string;
    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf-8")) as {
      files: Record<string, { conversations: Record<string, { processed_message_count: number }> }>;
    };
    const fileState = checkpoint.files[join(root, "supported.json")];
    expect(fileState).toBeDefined();
    const values = Object.values(fileState.conversations);
    expect(values).toHaveLength(1);
    expect(values[0].processed_message_count).toBe(2);
  });

  it("resumes from checkpoint and skips already-processed messages", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv Resume",
        source_conversation_id: "conv-resume",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
        ],
      },
    ]);

    const crashingImporter = jest.fn(async (conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: conversations[0].title,
        message_count: conversations[0].messages.length,
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: conversations[0].title,
        role: "assistant",
        message_index: conversations[0].message_offset ?? 0,
        memory_type: "output",
        preview: "m1",
      });
      throw new Error("simulated crash");
    });

    await expect(
      importFromPath(
        root,
        { project: "MemoryMesh", dryRun: true, delayMs: 0, verbose: false },
        { parse, importer: crashingImporter }
      )
    ).rejects.toThrow("simulated crash");

    const resumedImporter = jest.fn(async (conversations) => ({
      totalConversations: conversations.length,
      saved: conversations.reduce(
        (acc: number, conversation: { messages: Array<{ content: string }> }) =>
          acc + conversation.messages.length,
        0
      ),
      skipped: 0,
      skippedReasons: {},
    }));

    const summary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer: resumedImporter }
    );

    expect(summary.checkpointMode).toBe("dry_run");
    expect(summary.resumed).toBe(true);
    expect(summary.resumeSkippedMessages).toBeGreaterThanOrEqual(1);
    const resumedMessages = resumedImporter.mock.calls[0][0][0].messages;
    expect(resumedMessages).toHaveLength(1);
    expect(resumedMessages[0].content).toBe("m2");
  });

  it("supports --no-checkpoint behavior via option", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "Conv NC", messages: [{ role: "assistant", content: "x" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        checkpointEnabled: false,
      },
      { parse, importer }
    );

    expect(summary.checkpointUsed).toBe(false);
    expect(summary.checkpointMode).toBe("dry_run");
    const checkpointDir = process.env.MEMORYMESH_CHECKPOINT_DIR as string;
    expect(readdirSync(checkpointDir)).toHaveLength(0);
  });

  it("writes import audit jsonl with lifecycle, message, checkpoint and summary events", async () => {
    const auditRoot = mkdtempSync(join(tmpdir(), "memorymesh-cli-audit-"));
    process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED = "true";
    process.env.MEMORYMESH_IMPORT_AUDIT_DIR = auditRoot;
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const parse = jest.fn(() => [
      {
        title: "Conv Audit",
        source_conversation_id: "conv-audit",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
        ],
      },
    ]);

    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Audit",
        message_count: 2,
      });
      options?.callbacks?.onMessageStageChange?.({
        conversation_title: "Conv Audit",
        role: "assistant",
        message_index: 0,
        total_messages: 2,
        stage: "dedup",
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv Audit",
        role: "assistant",
        message_index: 0,
        memory_type: "context",
        ref_id: "ref-1",
        preview: "m1",
      });
      options?.callbacks?.onMessageSkipped?.({
        conversation_title: "Conv Audit",
        role: "assistant",
        message_index: 1,
        reason: "duplicate_ref_id",
        ref_id: "ref-2",
        preview: "m2",
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Audit",
        saved: 1,
        skipped: 1,
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 1,
        skippedReasons: { duplicate_ref_id: 1 },
      };
    });

    const summary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    expect(summary.auditLogPath).toBeDefined();
    const files = readdirSync(auditRoot).filter((file) => file.endsWith(".jsonl"));
    expect(files.length).toBe(1);
    const raw = readFileSync(join(auditRoot, files[0]), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string });
    const events = raw.map((row) => row.event);
    expect(events).toEqual(expect.arrayContaining([
      "run_started",
      "scan_started",
      "scan_completed",
      "checkpoint_loaded",
      "file_started",
      "conversation_started",
      "message_stage_changed",
      "message_imported",
      "message_skipped",
      "checkpoint_advanced",
      "conversation_completed",
      "file_completed",
      "run_completed",
    ]));
    rmSync(auditRoot, { recursive: true, force: true });
  });

  it("does not crash import when audit logging initialization fails", async () => {
    process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED = "true";
    const blockedPath = join(root, "audit-blocked");
    writeFileSync(blockedPath, "x", "utf-8");
    process.env.MEMORYMESH_IMPORT_AUDIT_DIR = join(blockedPath, "nested");
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "Conv NoAudit", messages: [{ role: "assistant", content: "x" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));

    await expect(
      importFromPath(
        root,
        { project: "MemoryMesh", dryRun: false, delayMs: 0 },
        { parse, importer }
      )
    ).resolves.toMatchObject({
      importedConversations: 1,
      savedMemories: 1,
    });
  });

  it("writes run_interrupted with message-level boundary data on deterministic debug stop", async () => {
    const auditRoot = mkdtempSync(join(tmpdir(), "memorymesh-cli-audit-interrupt-"));
    process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED = "true";
    process.env.MEMORYMESH_IMPORT_AUDIT_DIR = auditRoot;
    process.env.MEMORYMESH_IMPORT_DEBUG_STOP_AFTER_MESSAGES = "1";
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const parse = jest.fn(() => [
      {
        title: "Conv Interrupt",
        source_conversation_id: "conv-interrupt",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
        ],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Interrupt",
        message_count: 2,
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv Interrupt",
        role: "assistant",
        message_index: 0,
        memory_type: "context",
        ref_id: "ref-interrupt-1",
        preview: "m1",
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv Interrupt",
        role: "assistant",
        message_index: 1,
        memory_type: "context",
        ref_id: "ref-interrupt-2",
        preview: "m2",
      });
      return {
        totalConversations: 1,
        saved: 2,
        skipped: 0,
        skippedReasons: {},
      };
    });

    await expect(
      importFromPath(
        root,
        { project: "MemoryMesh", dryRun: false, delayMs: 0 },
        { parse, importer }
      )
    ).rejects.toThrow("debug stop threshold");

    const files = readdirSync(auditRoot).filter((file) => file.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const events = readFileSync(join(auditRoot, files[0]), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; [key: string]: unknown });
    const interrupted = events.find((event) => event.event === "run_interrupted");
    expect(interrupted).toBeDefined();
    expect(interrupted?.reason).toBe("debug_stop");
    expect(interrupted?.conversation_title).toBe("Conv Interrupt");
    expect(interrupted?.message_index).toBe(0);
    expect(interrupted?.checkpoint_next_message_count).toBe(1);
    expect(events.map((event) => event.event)).not.toContain("run_completed");
    expect(events.map((event) => event.event)).not.toContain("run_failed");
    rmSync(auditRoot, { recursive: true, force: true });
  });

  it("does not emit message_imported or checkpoint_advanced for partial persistence skips", async () => {
    const auditRoot = mkdtempSync(join(tmpdir(), "memorymesh-cli-audit-partial-"));
    process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED = "true";
    process.env.MEMORYMESH_IMPORT_AUDIT_DIR = auditRoot;
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const parse = jest.fn(() => [
      {
        title: "Conv Partial Audit",
        source_conversation_id: "conv-partial-audit",
        messages: [{ role: "assistant", content: "x1" }],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Partial Audit",
        message_count: 1,
      });
      options?.callbacks?.onMessageSkipped?.({
        conversation_title: "Conv Partial Audit",
        role: "assistant",
        message_index: 0,
        reason: "partial_persistence",
        ref_id: "ref-partial",
        preview: "x1",
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Partial Audit",
        saved: 0,
        skipped: 1,
      });
      return {
        totalConversations: 1,
        saved: 0,
        skipped: 1,
        skippedReasons: { partial_persistence: 1 },
      };
    });

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    const files = readdirSync(auditRoot).filter((file) => file.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const events = readFileSync(join(auditRoot, files[0]), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; reason?: string });
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain("message_skipped");
    expect(eventNames).not.toContain("message_imported");
    expect(eventNames).not.toContain("checkpoint_advanced");
    expect(events.some((event) => event.event === "message_skipped" && event.reason === "partial_persistence")).toBe(
      true
    );

    rmSync(auditRoot, { recursive: true, force: true });
  });

  it("uses separate checkpoint files for dry-run and real import", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv Mode Split",
        source_conversation_id: "conv-mode-split",
        messages: [{ role: "assistant", content: "m1" }],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Mode Split",
        message_count: 1,
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv Mode Split",
        role: "assistant",
        message_index: 0,
        memory_type: "context",
        preview: "m1",
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });

    const drySummary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer }
    );
    const realSummary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    expect(drySummary.checkpointPath).toContain("gpt-import-dry-run-");
    expect(realSummary.checkpointPath).toContain("gpt-import-real-");
    expect(drySummary.checkpointPath).not.toBe(realSummary.checkpointPath);
  });

  it("real import ignores dry-run checkpoint progress", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv Isolation",
        source_conversation_id: "conv-isolation",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
        ],
      },
    ]);

    const dryRunImporter = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Isolation",
        message_count: 2,
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "Conv Isolation",
        role: "assistant",
        message_index: 0,
        memory_type: "context",
        preview: "m1",
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer: dryRunImporter }
    );

    const realImporter = jest.fn(async (conversations) => ({
      totalConversations: conversations.length,
      saved: conversations[0].messages.length,
      skipped: 0,
      skippedReasons: {},
    }));

    const realSummary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer: realImporter }
    );

    expect(realSummary.checkpointMode).toBe("real");
    expect(realSummary.resumed).toBe(false);
    const firstCallMessages = realImporter.mock.calls[0][0][0].messages;
    expect(firstCallMessages).toHaveLength(2);
  });

  it("supports reset checkpoint option", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv Reset",
        source_conversation_id: "conv-reset",
        messages: [
          { role: "assistant", content: "x1" },
          { role: "assistant", content: "x2" },
        ],
      },
    ]);

    const importer = jest.fn(async (conversations) => ({
      totalConversations: conversations.length,
      saved: conversations[0].messages.length,
      skipped: 0,
      skippedReasons: {},
    }));

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer }
    );
    importer.mockClear();

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        resetCheckpoint: true,
      },
      { parse, importer }
    );

    expect(summary.resumed).toBe(false);
    const firstCallMessages = importer.mock.calls[0][0][0].messages;
    expect(firstCallMessages).toHaveLength(2);
  });

  it("does not advance checkpoint for non-deterministic skip reasons", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv ND",
        source_conversation_id: "conv-nd",
        messages: [{ role: "assistant", content: "x1" }],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv ND",
        message_count: 1,
      });
      options?.callbacks?.onMessageSkipped?.({
        conversation_title: "Conv ND",
        role: "assistant",
        message_index: 0,
        reason: "save_failed",
        preview: "x1",
      });
      return {
        totalConversations: 1,
        saved: 0,
        skipped: 1,
        skippedReasons: { save_failed: 1 },
      };
    });

    const summary = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    const checkpoint = JSON.parse(
      readFileSync(summary.checkpointPath as string, "utf-8")
    ) as {
      files: Record<string, { conversations: Record<string, { processed_message_count: number }> }>;
    };
    const fileState = checkpoint.files[join(root, "supported.json")];
    const counts = Object.values(fileState?.conversations ?? {}).map(
      (value) => value.processed_message_count
    );
    expect(counts).toEqual([]);
  });

  it("retries messages on rerun after partial persistence failures", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "Conv Partial Retry",
        source_conversation_id: "conv-partial-retry",
        messages: [{ role: "assistant", content: "x1" }],
      },
    ]);

    const failingImporter = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "Conv Partial Retry",
        message_count: 1,
      });
      options?.callbacks?.onMessageSkipped?.({
        conversation_title: "Conv Partial Retry",
        role: "assistant",
        message_index: 0,
        reason: "partial_persistence",
        preview: "x1",
      });
      return {
        totalConversations: 1,
        saved: 0,
        skipped: 1,
        skippedReasons: { partial_persistence: 1 },
      };
    });

    const first = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer: failingImporter }
    );
    expect(first.savedMemories).toBe(0);
    expect(first.skippedMemories).toBe(1);

    const checkpoint = JSON.parse(
      readFileSync(first.checkpointPath as string, "utf-8")
    ) as {
      files: Record<string, { conversations: Record<string, { processed_message_count: number }> }>;
    };
    const fileState = checkpoint.files[join(root, "supported.json")];
    const counts = Object.values(fileState?.conversations ?? {}).map(
      (value) => value.processed_message_count
    );
    expect(counts).toEqual([]);

    const successImporter = jest.fn(async (conversations) => ({
      totalConversations: 1,
      saved: conversations[0].messages.length,
      skipped: 0,
      skippedReasons: {},
    }));

    const second = await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer: successImporter }
    );

    expect(second.resumeSkippedMessages).toBe(0);
    expect(successImporter).toHaveBeenCalledTimes(1);
    const retriedMessages = successImporter.mock.calls[0][0][0].messages;
    expect(retriedMessages).toHaveLength(1);
    expect(retriedMessages[0].content).toBe("x1");
  });

  it("prints scan summary before file-level scan lines", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const scanTs = jest.fn((): IScanReport => ({
      scanned_json_files: 2,
      counts: {
        supported_conversation_file: 1,
        unsupported_conversation_schema: 1,
        ignorable_json: 0,
        unknown_json: 0,
        invalid_json: 0,
      },
      files: [
        {
          path: "/tmp/a.json",
          category: "unsupported_conversation_schema",
          reason: "group_chats_schema_not_supported_in_phase",
        },
        {
          path: "/tmp/b.json",
          category: "supported_conversation_file",
          reason: "array_with_mapping_and_current_node",
          content: "[{\"mapping\":{},\"current_node\":\"a\"}]",
        },
      ],
    }));
    const parse = jest.fn(() => [
      { title: "conv", messages: [{ role: "assistant", content: "hello" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0, verbose: true },
      { scanTs, parse, importer }
    );

    const lines = logSpy.mock.calls.map((call) => String(call[0]));
    const summaryIndex = lines.indexOf("+---------------------------------+-------+");
    const separatorIndex = lines.findIndex(
      (line, index) => line === "" && index > summaryIndex
    );
    const firstScanIndex = lines.findIndex((line) => line.startsWith("[scan] "));
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(separatorIndex).toBeGreaterThan(summaryIndex);
    expect(firstScanIndex).toBeGreaterThan(summaryIndex);
    expect(firstScanIndex).toBeGreaterThan(separatorIndex);
    logSpy.mockRestore();
  });

  it("renders overall/file/message progress with clear scope and file lifecycle logs", async () => {
    writeFileSync(
      join(root, "conversations-002.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "conv-1", messages: [{ role: "assistant", content: "one" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeSpy.mockClear();

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    const logs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    const writes = stripAnsi(
      writeSpy.mock.calls.map((call) => String(call[0])).join("")
    );
    expect(logs).toContain("Started conversation file 1/1: conversations-002.json");
    expect(logs).toContain("Running conversation file 1/1: conversations-002.json");
    expect(stripAnsi(logs)).toContain("Completed conversation file 1/1: conversations-002.json");
    expect(writes).toContain("[overall ]");
    expect(writes).toContain("completed files 1/1");
    expect(writes).toContain("completed conv");
    expect(writes).toContain("saved 0 | skipped 0 | resume-skipped 0");
    expect(writes).toContain("░");
    expect(writes).not.toContain("#");
    expect(writes).toContain("[file    ]");
    expect(writes).toContain("conversations-002.json | active conv 1/1");
    expect(writes).not.toContain("file 1/1 | conv");
    expect(writes).toContain("[message ]");
    expect(writes).toContain("ETA --:--");
  });

  it("renders message stage visibility", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "conv-stage", messages: [{ role: "assistant", content: "one" }] },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "conv-stage",
        message_count: 1,
      });
      options?.callbacks?.onMessageStart?.({
        conversation_title: "conv-stage",
        role: "assistant",
        message_index: 0,
        total_messages: 1,
        preview: "one",
      });
      options?.callbacks?.onMessageStageChange?.({
        conversation_title: "conv-stage",
        role: "assistant",
        message_index: 0,
        total_messages: 1,
        stage: "embedding",
        stage_detail: "chunk 1/12",
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "conv-stage",
        role: "assistant",
        message_index: 0,
        memory_type: "output",
        preview: "one",
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "conv-stage",
        saved: 1,
        skipped: 0,
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });
    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeSpy.mockClear();

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: true, delayMs: 0 },
      { parse, importer }
    );

    const writes = stripAnsi(
      writeSpy.mock.calls.map((call) => String(call[0])).join("")
    );
    expect(writes).toContain("stage=embedding chunk 1/12");
  });

  it("shows weighted overall progress movement before file completion", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      {
        title: "conv-weighted",
        messages: [
          { role: "assistant", content: "m1" },
          { role: "assistant", content: "m2" },
          { role: "assistant", content: "m3" },
          { role: "assistant", content: "m4" },
        ],
      },
    ]);
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "conv-weighted",
        message_count: 4,
      });
      options?.callbacks?.onMessageStart?.({
        conversation_title: "conv-weighted",
        role: "assistant",
        message_index: 0,
        total_messages: 4,
        preview: "m1",
      });
      options?.callbacks?.onMessageStageChange?.({
        conversation_title: "conv-weighted",
        role: "assistant",
        message_index: 0,
        total_messages: 4,
        stage: "embedding",
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "conv-weighted",
        role: "assistant",
        message_index: 0,
        memory_type: "output",
        preview: "m1",
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });
    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeSpy.mockClear();

    await importFromPath(
      root,
      { project: "MemoryMesh", dryRun: false, delayMs: 0 },
      { parse, importer }
    );

    const writes = stripAnsi(
      writeSpy.mock.calls.map((call) => String(call[0])).join("")
    );
    expect(
      /\[overall \] \[[█░]+\] completed files 0\/1 \| completed conv 0\/1 \| saved 1 \| skipped 0 \| resume-skipped 0 \| ETA --:--/.test(
        writes
      )
    ).toBe(true);
  });

  it("emits heartbeat during long-running stalled stage without spamming", async () => {
    jest.useFakeTimers();
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "conv-hb", messages: [{ role: "assistant", content: "one" }] },
    ]);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const importer = jest.fn(async (_conversations, _project, _dryRun, options) => {
      options?.callbacks?.onConversationStart?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "conv-hb",
        message_count: 1,
      });
      options?.callbacks?.onMessageStart?.({
        conversation_title: "conv-hb",
        role: "assistant",
        message_index: 0,
        total_messages: 1,
        preview: "one",
      });
      options?.callbacks?.onMessageStageChange?.({
        conversation_title: "conv-hb",
        role: "assistant",
        message_index: 0,
        total_messages: 1,
        stage: "embedding",
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25_000);
      });
      options?.callbacks?.onMessageImported?.({
        conversation_title: "conv-hb",
        role: "assistant",
        message_index: 0,
        memory_type: "output",
        preview: "one",
      });
      options?.callbacks?.onConversationComplete?.({
        conversation_index: 1,
        total_conversations: 1,
        title: "conv-hb",
        saved: 1,
        skipped: 0,
      });
      return {
        totalConversations: 1,
        saved: 1,
        skipped: 0,
        skippedReasons: {},
      };
    });

    try {
      const promise = importFromPath(
        root,
        { project: "MemoryMesh", dryRun: false, delayMs: 0 },
        { parse, importer }
      );

      await jest.advanceTimersByTimeAsync(25_500);
      await promise;

      const heartbeatLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .map((line) => stripAnsi(line))
        .filter((line) => line.startsWith("[heartbeat]"));
      expect(heartbeatLines.length).toBeGreaterThanOrEqual(2);
      expect(heartbeatLines.length).toBeLessThanOrEqual(3);
      expect(heartbeatLines[0]).toContain("stage=embedding");
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders colorized progress lines when color is enabled", async () => {
    const previousNoColor = process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "conv-color", messages: [{ role: "assistant", content: "one" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));
    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeSpy.mockClear();

    try {
      await importFromPath(
        root,
        { project: "MemoryMesh", dryRun: true, delayMs: 0 },
        { parse, importer }
      );
    } finally {
      delete process.env.FORCE_COLOR;
      if (previousNoColor !== undefined) {
        process.env.NO_COLOR = previousNoColor;
      }
    }

    const writes = writeSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(writes).toContain("\u001b[38;2;");
  });

  it("falls back to non-colorized progress lines when color is disabled", async () => {
    process.env.NO_COLOR = "1";
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    const parse = jest.fn(() => [
      { title: "conv-no-color", messages: [{ role: "assistant", content: "one" }] },
    ]);
    const importer = jest.fn(async () => ({
      totalConversations: 1,
      saved: 1,
      skipped: 0,
      skippedReasons: {},
    }));
    const writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    writeSpy.mockClear();

    try {
      await importFromPath(
        root,
        { project: "MemoryMesh", dryRun: true, delayMs: 0 },
        { parse, importer }
      );
    } finally {
      delete process.env.NO_COLOR;
    }

    const writes = writeSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(writes).not.toContain("\u001b[38;2;");
  });
});
