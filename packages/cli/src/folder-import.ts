import { parseConversations, importConversations, IImportRunOptions } from "./gpt-importer";
import { IGptConversation } from "@memorymesh/core";
import { JsonFileCategory } from "./json-shape-classifier";
import { IScanReport, scanJsonInputPath } from "./folder-scan";
import { IRustEngineOutput, runRustImporterEngine } from "./rust-engine";
import { colorizeProgressLine } from "./terminal-style";
import { ImportAuditLog } from "./import-audit-log";
import {
  buildConversationCheckpointKey,
  ImportCheckpoint,
} from "./import-checkpoint";

export interface IFolderImportOptions extends IImportRunOptions {
  project: string;
  dryRun: boolean;
  limit?: number;
  verbose?: boolean;
  engine?: "ts" | "rust";
  rustBinaryPath?: string;
  checkpointEnabled?: boolean;
  resetCheckpoint?: boolean;
  auditEnabled?: boolean;
  auditDirectory?: string;
  runtimeEnv?: NodeJS.ProcessEnv;
  onImportStarted?: () => Promise<void> | void;
}

export interface IFolderImportSummary {
  scannedJsonFiles: number;
  supportedConversationFiles: number;
  importedConversations: number;
  savedMemories: number;
  skippedMemories: number;
  categories: Record<JsonFileCategory, number>;
  skipReasons: Record<string, number>;
  checkpointUsed: boolean;
  resumed: boolean;
  checkpointPath?: string;
  checkpointMode: "dry_run" | "real";
  resumeSkippedMessages: number;
  auditLogPath?: string;
}

export interface IFolderImportDependencies {
  parse: typeof parseConversations;
  importer: typeof importConversations;
  scanTs: typeof scanJsonInputPath;
  scanRust: (
    inputPath: string,
    binaryPath?: string,
    env?: NodeJS.ProcessEnv
  ) => Promise<IRustEngineOutput>;
}

interface ISelectedConversationWithOffset {
  checkpointKey: string;
  conversation: IGptConversation;
}

interface IFileImportPlan {
  fileIndex: number;
  scannedPath: string;
  fileLabel: string;
  selectedWithOffsets: ISelectedConversationWithOffset[];
}

interface IRunPositionState {
  file_path?: string;
  file_label?: string;
  file_index?: number;
  file_total?: number;
  conversation_title?: string;
  source_conversation_id?: string;
  conversation_index_in_file?: number;
  conversation_total_in_file?: number;
  message_index?: number;
  total_messages?: number;
  stage?: "dedup" | "save" | "embedding" | "checkpoint" | "skipped" | "completed";
  stage_detail?: string;
  ref_id?: string;
  checkpoint_key?: string;
  checkpoint_next_message_count?: number;
}

class ImportInterruptedError extends Error {
  readonly signal?: NodeJS.Signals;
  readonly reason: "signal" | "debug_stop";

  constructor(reason: "signal" | "debug_stop", signal?: NodeJS.Signals) {
    super(
      reason === "signal"
        ? `Import interrupted by ${signal ?? "signal"}`
        : "Import interrupted by debug stop threshold"
    );
    this.name = "ImportInterruptedError";
    this.signal = signal;
    this.reason = reason;
  }
}

const PROGRESS_LINE_COUNT = 3;
const HEARTBEAT_INTERVAL_MS = 10_000;

async function withRuntimeEnv<T>(
  runtimeEnv: NodeJS.ProcessEnv | undefined,
  action: () => Promise<T>
): Promise<T> {
  if (!runtimeEnv) {
    return action();
  }

  const previous = {
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    MEMORYMESH_EMBEDDING_MODE: process.env.MEMORYMESH_EMBEDDING_MODE,
    MEMORYMESH_EMBEDDING_DIMENSION: process.env.MEMORYMESH_EMBEDDING_DIMENSION,
  };

  process.env.EMBEDDING_MODEL = runtimeEnv.EMBEDDING_MODEL;
  process.env.MEMORYMESH_EMBEDDING_MODE = runtimeEnv.MEMORYMESH_EMBEDDING_MODE;
  process.env.MEMORYMESH_EMBEDDING_DIMENSION = runtimeEnv.MEMORYMESH_EMBEDDING_DIMENSION;
  try {
    return await action();
  } finally {
    if (previous.EMBEDDING_MODEL === undefined) {
      delete process.env.EMBEDDING_MODEL;
    } else {
      process.env.EMBEDDING_MODEL = previous.EMBEDDING_MODEL;
    }
    if (previous.MEMORYMESH_EMBEDDING_MODE === undefined) {
      delete process.env.MEMORYMESH_EMBEDDING_MODE;
    } else {
      process.env.MEMORYMESH_EMBEDDING_MODE = previous.MEMORYMESH_EMBEDDING_MODE;
    }
    if (previous.MEMORYMESH_EMBEDDING_DIMENSION === undefined) {
      delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
    } else {
      process.env.MEMORYMESH_EMBEDDING_DIMENSION = previous.MEMORYMESH_EMBEDDING_DIMENSION;
    }
  }
}

export async function importFromPath(
  inputPath: string,
  options: IFolderImportOptions,
  deps: Partial<IFolderImportDependencies> = {
    parse: parseConversations,
    importer: importConversations,
    scanTs: scanJsonInputPath,
    scanRust: runRustImporterEngine,
  }
): Promise<IFolderImportSummary> {
  const resolvedDeps: IFolderImportDependencies = {
    parse: deps.parse ?? parseConversations,
    importer: deps.importer ?? importConversations,
    scanTs: deps.scanTs ?? scanJsonInputPath,
    scanRust: deps.scanRust ?? runRustImporterEngine,
  };
  const engine = options.engine ?? "ts";
  const executionMode = options.dryRun ? "dry_run" : "real";
  const audit = new ImportAuditLog(
    {
      mode: executionMode,
      project: options.project,
      input_path: inputPath,
      engine,
      import_policy: options.importPolicy ?? "skip_existing",
    },
    {
      enabled: options.auditEnabled,
      directory: options.auditDirectory,
    }
  );

  const checkpoint = new ImportCheckpoint(
    {
      input_path: inputPath,
      project: options.project,
      engine,
      import_policy: options.importPolicy ?? "skip_existing",
      execution_mode: executionMode,
    },
    {
      enabled: options.checkpointEnabled ?? true,
      reset: options.resetCheckpoint ?? false,
    }
  );
  const checkpointState = checkpoint.getState();
  let importStartNotified = false;
  const notifyImportStarted = async (): Promise<void> => {
    if (importStartNotified) {
      return;
    }
    importStartNotified = true;
    try {
      await options.onImportStarted?.();
    } catch {
      // Persisting import-start metadata must not block import execution.
    }
  };
  const runPosition: IRunPositionState = {};
  audit.writeEvent("run_started", {
    dry_run: options.dryRun,
    verbose: options.verbose ?? false,
    checkpoint_enabled: options.checkpointEnabled ?? true,
    checkpoint_path: checkpointState.path,
    checkpoint_mode: checkpointState.mode,
    checkpoint_resumed: checkpointState.resumed,
  });
  audit.writeEvent("scan_started");
  if (checkpointState.enabled) {
    audit.writeEvent("checkpoint_loaded", {
      checkpoint_path: checkpointState.path,
      checkpoint_mode: checkpointState.mode,
      resumed: checkpointState.resumed,
      reset: checkpointState.reset,
    });
    if (checkpointState.reset) {
      audit.writeEvent("checkpoint_reset", {
        checkpoint_path: checkpointState.path,
      });
    }
  }
  console.log("Starting scan for GPT export files...");
  const report =
    engine === "rust"
      ? toScanReport(
          await resolvedDeps.scanRust(
            inputPath,
            options.rustBinaryPath,
            options.runtimeEnv ?? process.env
          )
        )
      : resolvedDeps.scanTs(inputPath);
  console.log("Scan complete.");
  for (const line of buildScanSummaryTable(report)) {
    console.log(line);
  }
  console.log("");
  const summary: IFolderImportSummary = {
    scannedJsonFiles: report.scanned_json_files,
    supportedConversationFiles: report.counts.supported_conversation_file,
    importedConversations: 0,
    savedMemories: 0,
    skippedMemories: 0,
    categories: report.counts,
    skipReasons: {},
    checkpointUsed: checkpointState.enabled,
    resumed: checkpointState.resumed,
    checkpointPath: checkpointState.path,
    checkpointMode: checkpointState.mode,
    resumeSkippedMessages: 0,
    auditLogPath: audit.getPath(),
  };
  audit.writeEvent("scan_completed", {
    scanned_json_files: report.scanned_json_files,
    supported_conversation_files: report.counts.supported_conversation_file,
    unsupported_conversation_schema:
      report.counts.unsupported_conversation_schema,
    ignorable_json: report.counts.ignorable_json,
    unknown_json: report.counts.unknown_json,
    invalid_json: report.counts.invalid_json,
  });
  if (options.verbose && checkpointState.enabled) {
    const modeLabel = checkpointState.resumed ? "resume" : "fresh";
    console.log(
      `[checkpoint] ${modeLabel} | mode=${checkpointState.mode} | ${checkpointState.path}`
    );
    if (checkpointState.reset) {
      console.log("[checkpoint] reset requested");
    }
  }

  let remainingLimit = options.limit;
  const plans: IFileImportPlan[] = [];
  let nextFileIndex = 1;
  for (const scanned of report.files) {
    if (options.verbose || options.dryRun) {
      // File-level classification log keeps folder scan transparent.
      console.log(`[scan] ${scanned.category} | ${scanned.reason} | ${scanned.path}`);
    }
    if (scanned.category !== "supported_conversation_file") {
      continue;
    }
    if (remainingLimit !== undefined && remainingLimit <= 0) {
      break;
    }

    const conversations =
      scanned.conversations ?? resolvedDeps.parse(scanned.content ?? "");
    const selected =
      remainingLimit === undefined
        ? conversations
        : conversations.slice(0, remainingLimit);
    const selectedWithOffsets: ISelectedConversationWithOffset[] = [];
    for (let conversationIndex = 0; conversationIndex < selected.length; conversationIndex += 1) {
      const conversation = selected[conversationIndex];
      const checkpointKey = buildConversationCheckpointKey(
        conversation,
        conversationIndex
      );
      const processedCount = checkpoint.getProcessedCount(
        scanned.path,
        checkpointKey
      );
      if (processedCount > 0) {
        summary.resumed = true;
        summary.resumeSkippedMessages += Math.min(
          processedCount,
          conversation.messages.length
        );
      }
      if (processedCount >= conversation.messages.length) {
        continue;
      }
      selectedWithOffsets.push({
        checkpointKey,
        conversation: {
          title: conversation.title,
          source_conversation_id: conversation.source_conversation_id,
          message_offset: processedCount,
          messages: conversation.messages.slice(processedCount),
        },
      });
    }

    if (selectedWithOffsets.length > 0) {
      plans.push({
        fileIndex: nextFileIndex,
        scannedPath: scanned.path,
        fileLabel: fileNameFromPath(scanned.path),
        selectedWithOffsets,
      });
      nextFileIndex += 1;
    }
    if (remainingLimit !== undefined) {
      remainingLimit -= selectedWithOffsets.length;
    }
  }

  const progressState = {
    startedAtMs: Date.now(),
    filesTotal: plans.length,
    filesCompleted: 0,
    conversationsTotal: plans.reduce(
      (acc, plan) => acc + plan.selectedWithOffsets.length,
      0
    ),
    conversationsCompleted: 0,
    currentFileIndex: 0,
    currentFileTotal: 0,
    currentFileConversationsCompleted: 0,
    currentFileConversationsTotal: 0,
    currentFileLabel: "",
    currentMessageProcessed: 0,
    currentMessageTotal: 0,
    currentMessageIndex: 0,
    currentStageDetail: "",
    currentStage: "completed" as
      | "dedup"
      | "save"
      | "embedding"
      | "checkpoint"
      | "skipped"
      | "completed",
    liveSaved: 0,
    liveSkipped: 0,
    liveResumeSkipped: summary.resumeSkippedMessages,
    currentConversationStartedAtMs: 0,
    lastVisibleUpdateAtMs: Date.now(),
    lastHeartbeatAtMs: 0,
    lastRenderedSnapshot: "",
    rendered: false,
  };
  const debugStopAfterMessages = readPositiveIntEnv(
    process.env.MEMORYMESH_IMPORT_DEBUG_STOP_AFTER_MESSAGES
  );
  let completedMessageOutcomes = 0;
  let interruptionRequested = false;
  let interruptionSignal: NodeJS.Signals | undefined;
  const onInterruptSignal = (signal: NodeJS.Signals): void => {
    interruptionRequested = true;
    interruptionSignal = signal;
  };
  process.on("SIGINT", onInterruptSignal);
  process.on("SIGTERM", onInterruptSignal);

  const renderProgress = (): void => {
    if (progressState.filesTotal === 0) {
      return;
    }
    const overallCompletedUnits =
      progressState.conversationsCompleted +
      fraction(progressState.currentMessageProcessed, progressState.currentMessageTotal);
    const overallEta = formatEta(
      progressState.startedAtMs,
      overallCompletedUnits,
      progressState.conversationsTotal,
      { minElapsedMs: 15_000, minProgressRatio: 0.03 }
    );
    const overallLine =
      `[overall ] [${progressBar(overallCompletedUnits, progressState.conversationsTotal)}] ` +
      `completed files ${progressState.filesCompleted}/${progressState.filesTotal} | ` +
      `completed conv ${progressState.conversationsCompleted}/${progressState.conversationsTotal} | ` +
      `saved ${progressState.liveSaved} | skipped ${progressState.liveSkipped} | ` +
      `resume-skipped ${progressState.liveResumeSkipped} | ETA ${overallEta}`;
    const activeConversationPosition = getActiveConversationPosition(
      progressState.currentFileConversationsCompleted,
      progressState.currentFileConversationsTotal
    );
    const fileLine =
      `[file    ] [${progressBar(progressState.currentFileConversationsCompleted, Math.max(progressState.currentFileConversationsTotal, 1))}] ` +
      `${truncateFileLabel(progressState.currentFileLabel)} | ` +
      `active conv ${activeConversationPosition}/${progressState.currentFileConversationsTotal}`;
    const messageCurrent = Math.min(
      progressState.currentMessageIndex,
      Math.max(progressState.currentMessageTotal, 0)
    );
    const messageEta = formatEta(
      progressState.currentConversationStartedAtMs,
      progressState.currentMessageProcessed,
      progressState.currentMessageTotal
    );
    const stageLabel = progressState.currentStageDetail
      ? `${progressState.currentStage} ${progressState.currentStageDetail}`
      : progressState.currentStage;
    const messageLine =
      `[message ] [${progressBar(messageCurrent, Math.max(progressState.currentMessageTotal, 1))}] ` +
      `${messageCurrent}/${progressState.currentMessageTotal} msg | stage=${stageLabel} | ETA ${messageEta}`;

    const snapshot = [
      overallLine,
      fileLine,
      messageLine,
    ].join("|");
    if (snapshot !== progressState.lastRenderedSnapshot) {
      progressState.lastRenderedSnapshot = snapshot;
      progressState.lastVisibleUpdateAtMs = Date.now();
    }

    if (progressState.rendered) {
      process.stdout.write(`\x1b[${PROGRESS_LINE_COUNT}F`);
    } else {
      progressState.rendered = true;
    }
    process.stdout.write(
      `\x1b[2K${colorizeProgressLine("overall", overallLine)}\n`
    );
    process.stdout.write(`\x1b[2K${colorizeProgressLine("file", fileLine)}\n`);
    process.stdout.write(
      `\x1b[2K${colorizeProgressLine("message", messageLine)}\n`
    );
  };

  const clearProgress = (): void => {
    if (!progressState.rendered) {
      return;
    }
    process.stdout.write(`\x1b[${PROGRESS_LINE_COUNT}F`);
    for (let i = 0; i < PROGRESS_LINE_COUNT; i += 1) {
      process.stdout.write("\x1b[2K\n");
    }
    process.stdout.write(`\x1b[${PROGRESS_LINE_COUNT}F`);
    progressState.rendered = false;
  };

  const logWithProgress = (line: string): void => {
    clearProgress();
    console.log(line);
    renderProgress();
  };

  const maybeEmitHeartbeat = (): void => {
    if (!progressState.rendered) {
      return;
    }
    const now = Date.now();
    if (now - progressState.lastVisibleUpdateAtMs < HEARTBEAT_INTERVAL_MS) {
      return;
    }
    if (now - progressState.lastHeartbeatAtMs < HEARTBEAT_INTERVAL_MS) {
      return;
    }
    progressState.lastHeartbeatAtMs = now;
    logWithProgress(
      colorizeProgressLine(
        "heartbeat",
        `[heartbeat] still working | file ${progressState.currentFileIndex}/${progressState.filesTotal} | ` +
      `conv ${progressState.conversationsCompleted}/${progressState.conversationsTotal} | ` +
      `msg ${progressState.currentMessageIndex}/${progressState.currentMessageTotal} | ` +
          `stage=${progressState.currentStage}`
      )
    );
  };

  const assertRunNotInterrupted = (): void => {
    if (interruptionRequested) {
      throw new ImportInterruptedError("signal", interruptionSignal);
    }
    if (
      typeof debugStopAfterMessages === "number" &&
      completedMessageOutcomes >= debugStopAfterMessages
    ) {
      throw new ImportInterruptedError("debug_stop");
    }
  };

  const heartbeatTimer = setInterval(maybeEmitHeartbeat, 1000);
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }

  try {
    for (const plan of plans) {
      assertRunNotInterrupted();
      audit.writeEvent("file_started", {
        file_index: plan.fileIndex,
        file_total: plans.length,
        file_path: plan.scannedPath,
        file_label: plan.fileLabel,
        conversation_count_in_file: plan.selectedWithOffsets.length,
      });
      progressState.currentFileIndex = plan.fileIndex;
      progressState.currentFileTotal = plans.length;
      progressState.currentFileConversationsCompleted = 0;
      progressState.currentFileConversationsTotal = plan.selectedWithOffsets.length;
      progressState.currentFileLabel = plan.fileLabel;
      progressState.currentMessageProcessed = 0;
      progressState.currentMessageTotal = 0;
      progressState.currentMessageIndex = 0;
      progressState.currentStageDetail = "";
      progressState.currentStage = "completed";
      runPosition.file_path = plan.scannedPath;
      runPosition.file_label = plan.fileLabel;
      runPosition.file_index = plan.fileIndex;
      runPosition.file_total = plans.length;
      runPosition.conversation_title = undefined;
      runPosition.source_conversation_id = undefined;
      runPosition.conversation_index_in_file = undefined;
      runPosition.conversation_total_in_file = undefined;
      runPosition.message_index = undefined;
      runPosition.total_messages = undefined;
      runPosition.stage = "completed";
      runPosition.stage_detail = undefined;
      runPosition.ref_id = undefined;
      runPosition.checkpoint_key = undefined;
      runPosition.checkpoint_next_message_count = undefined;
      logWithProgress(
        `Started conversation file ${plan.fileIndex}/${plans.length}: ${plan.fileLabel}`
      );
      logWithProgress(
        `Running conversation file ${plan.fileIndex}/${plans.length}: ${plan.fileLabel}`
      );

      let activeConversationIndex = -1;
      const result = await withRuntimeEnv(options.runtimeEnv, async () =>
        resolvedDeps.importer(
          plan.selectedWithOffsets.map((item) => item.conversation),
          options.project,
          options.dryRun,
          {
            delayMs: options.delayMs,
            verbose: false,
            showConversationProgress: false,
            importPolicy: options.importPolicy,
            callbacks: {
            onConversationStart: (context) => {
              void notifyImportStarted();
              assertRunNotInterrupted();
              activeConversationIndex = context.conversation_index - 1;
              progressState.currentConversationStartedAtMs = Date.now();
              progressState.currentMessageProcessed = 0;
              progressState.currentMessageTotal = context.message_count;
              progressState.currentMessageIndex = 0;
              progressState.currentStageDetail = "";
              progressState.currentStage = "dedup";
              const activeConversation =
                plan.selectedWithOffsets[activeConversationIndex]?.conversation;
              runPosition.conversation_title = context.title;
              runPosition.source_conversation_id =
                activeConversation?.source_conversation_id;
              runPosition.conversation_index_in_file = context.conversation_index;
              runPosition.conversation_total_in_file = context.total_conversations;
              runPosition.message_index = 0;
              runPosition.total_messages = context.message_count;
              runPosition.stage = "dedup";
              runPosition.stage_detail = undefined;
              runPosition.ref_id = undefined;
              runPosition.checkpoint_key =
                plan.selectedWithOffsets[activeConversationIndex]?.checkpointKey;
              renderProgress();
              audit.writeEvent("conversation_started", {
                file_path: plan.scannedPath,
                file_label: plan.fileLabel,
                conversation_index_in_file: context.conversation_index,
                title: context.title,
                source_conversation_id:
                  activeConversation?.source_conversation_id ?? null,
                total_messages: context.message_count,
                message_offset: activeConversation?.message_offset ?? 0,
              });
            },
            onConversationComplete: (context) => {
              assertRunNotInterrupted();
              progressState.currentFileConversationsCompleted += 1;
              progressState.conversationsCompleted += 1;
              progressState.currentStageDetail = "";
              progressState.currentStage = "completed";
              runPosition.conversation_title = context.title;
              runPosition.conversation_index_in_file = context.conversation_index;
              runPosition.conversation_total_in_file = context.total_conversations;
              runPosition.stage = "completed";
              runPosition.stage_detail = undefined;
              renderProgress();
              const activeConversation =
                plan.selectedWithOffsets[activeConversationIndex]?.conversation;
              audit.writeEvent("conversation_completed", {
                file_path: plan.scannedPath,
                file_label: plan.fileLabel,
                conversation_index_in_file: context.conversation_index,
                title: context.title,
                source_conversation_id:
                  activeConversation?.source_conversation_id ?? null,
                total_messages: activeConversation?.messages.length ?? 0,
                message_offset: activeConversation?.message_offset ?? 0,
                saved_count: context.saved,
                skipped_count: context.skipped,
              });
            },
            onMessageStart: (context) => {
              assertRunNotInterrupted();
              const conversationOffset = plan.selectedWithOffsets[
                activeConversationIndex
              ]?.conversation.message_offset ?? 0;
              progressState.currentMessageIndex = Math.min(
                context.message_index - conversationOffset + 1,
                progressState.currentMessageTotal
              );
              progressState.currentStageDetail = "";
              progressState.currentStage = "dedup";
              runPosition.message_index = context.message_index;
              runPosition.total_messages = context.total_messages;
              runPosition.stage = "dedup";
              runPosition.stage_detail = undefined;
              renderProgress();
            },
            onMessageStageChange: (context) => {
              assertRunNotInterrupted();
              const conversationOffset = plan.selectedWithOffsets[
                activeConversationIndex
              ]?.conversation.message_offset ?? 0;
              progressState.currentMessageIndex = Math.min(
                context.message_index - conversationOffset + 1,
                progressState.currentMessageTotal
              );
              progressState.currentStageDetail = context.stage_detail ?? "";
              progressState.currentStage = context.stage;
              runPosition.message_index = context.message_index;
              runPosition.total_messages = context.total_messages;
              runPosition.stage = context.stage;
              runPosition.stage_detail = context.stage_detail;
              runPosition.ref_id = context.ref_id;
              renderProgress();
              const activeConversation =
                plan.selectedWithOffsets[activeConversationIndex]?.conversation;
              audit.writeEvent("message_stage_changed", {
                file_path: plan.scannedPath,
                title: context.conversation_title,
                source_conversation_id:
                  activeConversation?.source_conversation_id ?? null,
                message_index: context.message_index,
                role: context.role,
                stage: context.stage,
                stage_detail: context.stage_detail ?? null,
                ref_id: context.ref_id ?? null,
              });
            },
            onMessageImported: (context) => {
              assertRunNotInterrupted();
              const item = plan.selectedWithOffsets[activeConversationIndex];
              if (!item) {
                return;
              }
              const nextMessageCount = context.message_index + 1;
              checkpoint.advance(plan.scannedPath, item.checkpointKey, nextMessageCount);
              runPosition.checkpoint_key = item.checkpointKey;
              runPosition.checkpoint_next_message_count = nextMessageCount;
              audit.writeEvent("checkpoint_advanced", {
                file_path: plan.scannedPath,
                checkpoint_key: item.checkpointKey,
                next_message_count: nextMessageCount,
              });
              progressState.currentMessageProcessed = Math.min(
                progressState.currentMessageProcessed + 1,
                progressState.currentMessageTotal
              );
              progressState.currentMessageIndex = progressState.currentMessageProcessed;
              progressState.liveSaved += 1;
              progressState.currentStageDetail = "";
              progressState.currentStage = "checkpoint";
              runPosition.message_index = context.message_index;
              runPosition.stage = "checkpoint";
              runPosition.stage_detail = undefined;
              runPosition.ref_id = context.ref_id;
              renderProgress();
              audit.writeEvent("message_imported", {
                file_path: plan.scannedPath,
                title: context.conversation_title,
                source_conversation_id:
                  item.conversation.source_conversation_id ?? null,
                message_index: context.message_index,
                role: context.role,
                memory_type: context.memory_type,
                ref_id: context.ref_id ?? null,
              });
              if (options.verbose) {
                const ref = context.ref_id ? ` | ref_id=${context.ref_id}` : "";
                logWithProgress(
                  `[import] SAVED | title=${context.conversation_title} | msg_index=${context.message_index}${ref} | memory_type=${context.memory_type}`
                );
              }
              completedMessageOutcomes += 1;
              assertRunNotInterrupted();
            },
            onMessageSkipped: (context) => {
              assertRunNotInterrupted();
              const item = plan.selectedWithOffsets[activeConversationIndex];
              if (item && isDeterministicSkipReason(context.reason)) {
                const nextMessageCount = context.message_index + 1;
                checkpoint.advance(plan.scannedPath, item.checkpointKey, nextMessageCount);
                runPosition.checkpoint_key = item.checkpointKey;
                runPosition.checkpoint_next_message_count = nextMessageCount;
                audit.writeEvent("checkpoint_advanced", {
                  file_path: plan.scannedPath,
                  checkpoint_key: item.checkpointKey,
                  next_message_count: nextMessageCount,
                });
                progressState.currentStage = "checkpoint";
              } else {
                progressState.currentStage = "skipped";
              }
              progressState.currentMessageProcessed = Math.min(
                progressState.currentMessageProcessed + 1,
                progressState.currentMessageTotal
              );
              progressState.currentMessageIndex = progressState.currentMessageProcessed;
              progressState.liveSkipped += 1;
              runPosition.message_index = context.message_index;
              runPosition.stage_detail = undefined;
              runPosition.ref_id = context.ref_id;
              renderProgress();
              audit.writeEvent("message_skipped", {
                file_path: plan.scannedPath,
                title: context.conversation_title,
                source_conversation_id:
                  item?.conversation.source_conversation_id ?? null,
                message_index: context.message_index,
                role: context.role,
                ref_id: context.ref_id ?? null,
                reason: context.reason,
                payload_bytes: context.payload_bytes ?? null,
              });
              if (options.verbose) {
                const ref = context.ref_id ? ` | ref_id=${context.ref_id}` : "";
                const size =
                  typeof context.payload_bytes === "number"
                    ? ` | payload_bytes=${context.payload_bytes}`
                    : "";
                logWithProgress(
                  `[import] SKIP | title=${context.conversation_title} | msg_index=${context.message_index}${ref} | reason=${context.reason}${size}`
                );
              }
              completedMessageOutcomes += 1;
              assertRunNotInterrupted();
            },
            },
          }
        ));

      summary.importedConversations += result.totalConversations;
      summary.savedMemories += result.saved;
      summary.skippedMemories += result.skipped;

      for (const [reason, count] of Object.entries(result.skippedReasons)) {
        summary.skipReasons[reason] = (summary.skipReasons[reason] ?? 0) + count;
      }

      progressState.filesCompleted += 1;
      progressState.currentStage = "completed";
      renderProgress();
      logWithProgress(
        colorizeProgressLine(
          "success",
          `Completed conversation file ${plan.fileIndex}/${plans.length}: ${plan.fileLabel}`
        )
      );
      audit.writeEvent("file_completed", {
        file_index: plan.fileIndex,
        file_total: plans.length,
        file_path: plan.scannedPath,
        file_label: plan.fileLabel,
        conversation_count_in_file: plan.selectedWithOffsets.length,
      });
    }
    audit.writeEvent("run_completed", {
      imported_conversations: summary.importedConversations,
      saved: summary.savedMemories,
      skipped: summary.skippedMemories,
      skipped_reasons: summary.skipReasons,
      checkpoint_used: summary.checkpointUsed,
      resumed: summary.resumed,
      resume_skipped_messages: summary.resumeSkippedMessages,
      ...toRunBoundaryPositionPayload(runPosition),
    });
  } catch (error) {
    if (error instanceof ImportInterruptedError) {
      audit.writeEvent("run_interrupted", {
        reason: error.reason,
        signal: error.signal ?? interruptionSignal ?? null,
        imported_conversations: summary.importedConversations,
        saved: summary.savedMemories,
        skipped: summary.skippedMemories,
        checkpoint_used: summary.checkpointUsed,
        resumed: summary.resumed,
        resume_skipped_messages: summary.resumeSkippedMessages,
        ...toRunBoundaryPositionPayload(runPosition),
      });
    } else {
      audit.writeEvent("run_failed", {
        error_message: error instanceof Error ? error.message : String(error),
        imported_conversations: summary.importedConversations,
        saved: summary.savedMemories,
        skipped: summary.skippedMemories,
        checkpoint_used: summary.checkpointUsed,
        resumed: summary.resumed,
        resume_skipped_messages: summary.resumeSkippedMessages,
        ...toRunBoundaryPositionPayload(runPosition),
      });
    }
    throw error;
  } finally {
    process.off("SIGINT", onInterruptSignal);
    process.off("SIGTERM", onInterruptSignal);
    clearInterval(heartbeatTimer);
    clearProgress();
    await audit.close();
    if (summary.auditLogPath) {
      console.log(`Audit log written to: ${summary.auditLogPath}`);
    }
  }

  return summary;
}

function isDeterministicSkipReason(reason: string): boolean {
  return (
    reason === "duplicate_ref_id" ||
    reason === "payload_too_large" ||
    reason === "embedding_input_too_large" ||
    reason === "overwrite_existing_not_supported" ||
    reason.startsWith("unsupported_role:")
  );
}

function toScanReport(output: IRustEngineOutput): IScanReport {
  return {
    scanned_json_files: output.scan_summary.scanned_json_files,
    counts: {
      supported_conversation_file:
        output.scan_summary.supported_conversation_file,
      unsupported_conversation_schema:
        output.scan_summary.unsupported_conversation_schema,
      ignorable_json: output.scan_summary.ignorable_json,
      unknown_json: output.scan_summary.unknown_json,
      invalid_json: output.scan_summary.invalid_json,
    },
    files: output.files.map((file) => ({
      path: file.path,
      category: file.category,
      reason: file.reason,
      content: undefined,
      conversations: file.conversations,
    })),
  };
}

function buildScanSummaryTable(report: IScanReport): string[] {
  const rows: Array<[string, number]> = [
    ["Scanned JSON files", report.scanned_json_files],
    ["Supported conversation files", report.counts.supported_conversation_file],
    [
      "Unsupported conversation schema",
      report.counts.unsupported_conversation_schema,
    ],
    ["Ignorable JSON", report.counts.ignorable_json],
    ["Unknown JSON", report.counts.unknown_json],
    ["Invalid JSON", report.counts.invalid_json],
  ];
  const labelWidth = Math.max(
    "Scan Summary".length,
    ...rows.map((row) => row[0].length)
  );
  const countWidth = Math.max(
    "Count".length,
    ...rows.map((row) => String(row[1]).length)
  );
  const top = `+${"-".repeat(labelWidth + 2)}+${"-".repeat(countWidth + 2)}+`;
  const header =
    `| ${padRight("Scan Summary", labelWidth)} | ${padLeft("Count", countWidth)} |`;
  const lines = [top, header, top];
  for (const [label, count] of rows) {
    lines.push(
      `| ${padRight(label, labelWidth)} | ${padLeft(String(count), countWidth)} |`
    );
  }
  lines.push(top);
  return lines;
}

function progressBar(current: number, total: number, width = 24): string {
  const useAsciiFallback =
    process.env.MEMORYMESH_PROGRESS_ASCII === "1" ||
    process.env.MEMORYMESH_PROGRESS_ASCII === "true";
  const filledChar = useAsciiFallback ? "#" : "█";
  const emptyChar = useAsciiFallback ? "-" : "░";
  if (total <= 0) {
    return emptyChar.repeat(width);
  }
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * width);
  return `${filledChar.repeat(filled)}${emptyChar.repeat(width - filled)}`;
}

function toRunBoundaryPositionPayload(
  state: IRunPositionState
): Record<string, unknown> {
  return {
    file_path: state.file_path ?? null,
    file_label: state.file_label ?? null,
    file_index: state.file_index ?? null,
    file_total: state.file_total ?? null,
    conversation_title: state.conversation_title ?? null,
    source_conversation_id: state.source_conversation_id ?? null,
    conversation_index_in_file: state.conversation_index_in_file ?? null,
    conversation_total_in_file: state.conversation_total_in_file ?? null,
    message_index: state.message_index ?? null,
    total_messages: state.total_messages ?? null,
    stage: state.stage ?? null,
    stage_detail: state.stage_detail ?? null,
    ref_id: state.ref_id ?? null,
    checkpoint_key: state.checkpoint_key ?? null,
    checkpoint_next_message_count: state.checkpoint_next_message_count ?? null,
  };
}

function formatEta(
  startedAtMs: number,
  completed: number,
  total: number,
  options: { minElapsedMs?: number; minProgressRatio?: number } = {}
): string {
  if (completed <= 0 || total <= 0) {
    return "--:--";
  }
  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs <= 0) {
    return "--:--";
  }
  const minElapsedMs = options.minElapsedMs ?? 0;
  const minProgressRatio = options.minProgressRatio ?? 0;
  const progressRatio = completed / total;
  if (elapsedMs < minElapsedMs || progressRatio < minProgressRatio) {
    return "--:--";
  }
  const estimatedTotalMs = (elapsedMs / completed) * total;
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
  const seconds = Math.round(remainingMs / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

function fraction(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.min(Math.max(numerator / denominator, 0), 1);
}

function readPositiveIntEnv(rawValue: string | undefined): number | undefined {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return undefined;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function getActiveConversationPosition(
  completedConversations: number,
  totalConversations: number
): number {
  if (totalConversations <= 0) {
    return 0;
  }
  return Math.min(completedConversations + 1, totalConversations);
}

function padRight(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function padLeft(value: string, width: number): string {
  return value.padStart(width, " ");
}

function fileNameFromPath(pathValue: string): string {
  const parts = pathValue.split(/[\\/]/);
  return parts[parts.length - 1] ?? pathValue;
}

function truncateFileLabel(value: string, maxLength = 40): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
