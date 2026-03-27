import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  CancellationToken,
  IImportPolicy,
  ISourceMetadata,
  ImportInterruptedError,
} from "@memorymesh/core";
import {
  createRuntimeImporterGateway,
  ensureEmbeddingModelAvailable,
  waitForBackgroundSaveTasks,
} from "@memorymesh/runtime";
import { getMemoryMeshConfigPath } from "./installer/first-run";
import { ImportAuditLog } from "./import-audit-log";
import { ImportCheckpoint } from "./import-checkpoint";
import {
  IRustDocumentEngineOutput,
  IRustDocumentFileResult,
  runRustDocumentImporterEngine,
} from "./rust-engine";
import { colorizeProgressLine } from "./terminal-style";

const SUPPORTED_EXTENSIONS = new Set([".csv", ".json", ".jsonl", ".ndjson", ".md", ".txt"]);
const DEFAULT_LIMITS: IDocumentImportLimits = {
  max_file_size_mb: 5,
  max_chars_per_file: 100000,
  max_chunks_per_file: 200,
  chunk_size: 1200,
  chunk_overlap: 150,
};
const PROGRESS_LINE_COUNT = 3;
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface IDocumentImportLimits {
  max_file_size_mb: number;
  max_chars_per_file: number;
  max_chunks_per_file: number;
  chunk_size: number;
  chunk_overlap: number;
}

export interface IDocumentImportOptions {
  project: string;
  dryRun?: boolean;
  importPolicy?: IImportPolicy;
  checkpointEnabled?: boolean;
  resetCheckpoint?: boolean;
  runtimeEnv?: NodeJS.ProcessEnv;
  homeDir?: string;
  onImportStarted?: () => Promise<void> | void;
}

export interface IDocumentImportSummary {
  inputPath: string;
  discoveredFiles: number;
  supportedFiles: number;
  skippedFiles: number;
  importedChunks: number;
  skippedChunks: number;
  skipReasons: Record<string, number>;
  checkpointUsed: boolean;
  resumed: boolean;
  checkpointPath?: string;
  checkpointMode: "dry_run" | "real";
  auditLogPath?: string;
}

interface IDiscoveredFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  chunks: IDocumentChunk[];
}

interface IDocumentChunk {
  content: string;
  chunkIndex: number;
  chunkTotal: number;
}

interface IParsedDocument {
  chunks: IDocumentChunk[];
  reason?: string;
}

interface IRawConfig {
  documentImportLimits?: Partial<IDocumentImportLimits>;
}

interface IDocumentImportDeps {
  parseWithRust: (
    inputPath: string,
    limits: IDocumentImportLimits,
    env?: NodeJS.ProcessEnv
  ) => Promise<IRustDocumentEngineOutput>;
}

interface IDocumentFilePlan {
  file: IDiscoveredFile;
  fileIndex: number;
  checkpointKey: string;
  processedCount: number;
  activeChunks: IDocumentChunk[];
}

export async function importDocumentsFromPath(
  inputPath: string,
  options: IDocumentImportOptions,
  deps: Partial<IDocumentImportDeps> = {}
): Promise<IDocumentImportSummary> {
  const resolvedDeps: IDocumentImportDeps = {
    parseWithRust:
      deps.parseWithRust
      ?? ((inputPath, limits, env) =>
        runRustDocumentImporterEngine(inputPath, limits, undefined, env)),
  };
  const absoluteInput = resolve(inputPath);
  const executionMode = options.dryRun ? "dry_run" : "real";
  const importPolicy = options.importPolicy ?? "skip_existing";
  const homeDir = options.homeDir ?? resolveUserHomeDir();
  const limits = await resolveDocumentImportLimits(homeDir);
  const checkpoint = new ImportCheckpoint(
    {
      input_path: absoluteInput,
      project: options.project,
      engine: "ts",
      import_policy: importPolicy,
      execution_mode: executionMode,
      import_kind: "document",
      embedding_mode: options.runtimeEnv?.MEMORYMESH_EMBEDDING_MODE,
      embedding_model: options.runtimeEnv?.EMBEDDING_MODEL,
      embedding_dimension: parseEmbeddingDimension(
        options.runtimeEnv?.MEMORYMESH_EMBEDDING_DIMENSION
      ),
    },
    {
      enabled: options.checkpointEnabled ?? true,
      reset: options.resetCheckpoint ?? false,
    }
  );
  const checkpointState = checkpoint.getState();
  const audit = new ImportAuditLog(
    {
      mode: executionMode,
      project: options.project,
      input_path: absoluteInput,
      engine: "ts",
      import_policy: importPolicy,
    }
  );

  audit.writeEvent("run_started", {
    mode: "document_import",
    checkpoint_enabled: checkpointState.enabled,
    checkpoint_path: checkpointState.path,
  });
  if (checkpointState.enabled) {
    audit.writeEvent("checkpoint_loaded", {
      checkpoint_mode: checkpointState.mode,
      checkpoint_path: checkpointState.path,
      resumed: checkpointState.resumed,
      reset: checkpointState.reset,
    });
  }

  const parsedOutput = await parseDocumentInputWithRustPreferred(
    absoluteInput,
    limits,
    options.runtimeEnv,
    resolvedDeps.parseWithRust
  );
  const summary: IDocumentImportSummary = {
    inputPath: absoluteInput,
    discoveredFiles: parsedOutput.scan_summary.discovered_files,
    supportedFiles: parsedOutput.scan_summary.supported_files,
    skippedFiles: parsedOutput.scan_summary.skipped_files,
    importedChunks: 0,
    skippedChunks: 0,
    skipReasons: {},
    checkpointUsed: checkpointState.enabled,
    resumed: checkpointState.resumed,
    checkpointPath: checkpointState.path,
    checkpointMode: checkpointState.mode,
    auditLogPath: audit.getPath(),
  };

  const cancellationToken = new CancellationToken();
  let importStartedNotified = false;
  const notifyImportStarted = async (): Promise<void> => {
    if (importStartedNotified) {
      return;
    }
    importStartedNotified = true;
    try {
      await options.onImportStarted?.();
    } catch {
      // Persisting import-start metadata must not block import execution.
    }
  };

  const onSignal = (): void => {
    cancellationToken.cancel();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  let heartbeatTimer: NodeJS.Timeout | undefined;
  const progressState = {
    startedAtMs: Date.now(),
    filesTotal: 0,
    filesCompleted: 0,
    chunksTotal: 0,
    chunksCompleted: 0,
    currentFileIndex: 0,
    currentFileLabel: "",
    currentFileChunksTotal: 0,
    currentFileChunksProcessed: 0,
    currentChunkDisplayIndex: 0,
    currentChunkDisplayTotal: 0,
    currentStage: "completed",
    liveSaved: 0,
    liveSkipped: 0,
    liveResumeSkipped: 0,
    lastVisibleUpdateAtMs: Date.now(),
    lastHeartbeatAtMs: 0,
    lastRenderedSnapshot: "",
    rendered: false,
  };

  const renderProgress = (): void => {
    if (progressState.filesTotal <= 0) {
      return;
    }
    const overallLine =
      `[overall ] [${progressBar(progressState.chunksCompleted, Math.max(progressState.chunksTotal, 1))}] ` +
      `completed files ${progressState.filesCompleted}/${progressState.filesTotal} | ` +
      `chunks ${progressState.chunksCompleted}/${progressState.chunksTotal} | ` +
      `saved ${progressState.liveSaved} | skipped ${progressState.liveSkipped} | ` +
      `resume-skipped ${progressState.liveResumeSkipped} | ETA ${formatEta(progressState.startedAtMs, progressState.chunksCompleted, progressState.chunksTotal, { minElapsedMs: 10_000, minProgressRatio: 0.03 })}`;
    const fileLine =
      `[file    ] [${progressBar(progressState.currentFileChunksProcessed, Math.max(progressState.currentFileChunksTotal, 1))}] ` +
      `${truncateFileLabel(progressState.currentFileLabel)} | ` +
      `file ${progressState.currentFileIndex}/${progressState.filesTotal} | ` +
      `chunk ${Math.min(progressState.currentChunkDisplayIndex, Math.max(progressState.currentChunkDisplayTotal, 0))}/${progressState.currentChunkDisplayTotal}`;
    const chunkLine =
      `[chunk   ] [${progressBar(progressState.currentChunkDisplayIndex, Math.max(progressState.currentChunkDisplayTotal, 1))}] ` +
      `${progressState.currentChunkDisplayIndex}/${progressState.currentChunkDisplayTotal} | stage=${progressState.currentStage}`;

    const snapshot = `${overallLine}|${fileLine}|${chunkLine}`;
    if (snapshot !== progressState.lastRenderedSnapshot) {
      progressState.lastRenderedSnapshot = snapshot;
      progressState.lastVisibleUpdateAtMs = Date.now();
    }

    if (progressState.rendered) {
      process.stdout.write(`\x1b[${PROGRESS_LINE_COUNT}F`);
    } else {
      progressState.rendered = true;
    }
    process.stdout.write(`\x1b[2K${colorizeProgressLine("overall", overallLine)}\n`);
    process.stdout.write(`\x1b[2K${colorizeProgressLine("file", fileLine)}\n`);
    process.stdout.write(`\x1b[2K${colorizeProgressLine("message", chunkLine)}\n`);
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
        `[heartbeat] still working | file ${progressState.currentFileIndex}/${progressState.filesTotal} | chunk ${progressState.chunksCompleted}/${progressState.chunksTotal} | stage=${progressState.currentStage}`
      )
    );
  };

  try {
    return await withRuntimeEnv(options.runtimeEnv, async () => {
      try {
        if (!options.dryRun) {
          await ensureEmbeddingModelAvailable();
        }

        const gateway = createRuntimeImporterGateway(cancellationToken);
        for (const parsedFile of parsedOutput.files) {
          if (parsedFile.status !== "skipped") {
            continue;
          }
          if (parsedFile.reason) {
            increment(summary.skipReasons, parsedFile.reason);
          }
          audit.writeEvent("warning", {
            file_path: parsedFile.path,
            reason: parsedFile.reason,
          });
        }

        const supportedFiles = parsedOutput.files.filter((file) => file.status === "supported");
        const filePlans: IDocumentFilePlan[] = [];
        for (let fileIndex = 0; fileIndex < supportedFiles.length; fileIndex += 1) {
          cancellationToken.throwIfCancelled();
          const file = toDiscoveredFile(supportedFiles[fileIndex]);

          const checkpointKey = buildDocumentCheckpointKey(file.absolutePath);
          const processedCount = checkpoint.getProcessedCount(file.absolutePath, checkpointKey);
          if (processedCount > 0) {
            summary.resumed = true;
            progressState.liveResumeSkipped += Math.min(processedCount, file.chunks.length);
          }
          const activeChunks = file.chunks.slice(processedCount);
          if (activeChunks.length === 0) {
            continue;
          }
          filePlans.push({
            file,
            fileIndex: filePlans.length + 1,
            checkpointKey,
            processedCount,
            activeChunks,
          });
        }

        progressState.filesTotal = filePlans.length;
        progressState.chunksTotal = filePlans.reduce((acc, plan) => acc + plan.activeChunks.length, 0);
        if (progressState.filesTotal > 0) {
          heartbeatTimer = setInterval(maybeEmitHeartbeat, 1000);
          if (typeof heartbeatTimer.unref === "function") {
            heartbeatTimer.unref();
          }
          renderProgress();
        }

        for (const plan of filePlans) {
          cancellationToken.throwIfCancelled();
          const { file, checkpointKey, processedCount, activeChunks } = plan;

          audit.writeEvent("file_started", {
            file_path: file.absolutePath,
            relative_path: file.relativePath,
            extension: file.extension,
            file_index: plan.fileIndex,
            file_total: filePlans.length,
            chunk_total: file.chunks.length,
          });
          progressState.currentFileIndex = plan.fileIndex;
          progressState.currentFileLabel = file.relativePath;
          progressState.currentFileChunksTotal = activeChunks.length;
          progressState.currentFileChunksProcessed = 0;
          progressState.currentChunkDisplayIndex = 0;
          progressState.currentChunkDisplayTotal = activeChunks.length;
          progressState.currentStage = "checking_existing";
          renderProgress();

          for (let chunkOffset = 0; chunkOffset < activeChunks.length; chunkOffset += 1) {
            cancellationToken.throwIfCancelled();
            const chunk = activeChunks[chunkOffset];
            const displayChunkIndex = chunkOffset + 1;
            progressState.currentChunkDisplayIndex = displayChunkIndex;
            progressState.currentChunkDisplayTotal = activeChunks.length;
            const refIdBase = buildDocumentRefId(file.absolutePath, chunk.chunkIndex, chunk.content);
            const sourceMetadata = buildDocumentSourceMetadata(
              file,
              chunk,
              options.project,
              refIdBase
            );
            const payload = {
              content: buildChunkContent(file, chunk),
              project: options.project,
              memory_type: "context" as const,
              source_agent: "memorymesh-cli",
              source_format: "document_import_v1",
              source_type: "document" as const,
              title: `${file.relativePath} [${chunk.chunkIndex + 1}/${chunk.chunkTotal}]`,
              conversation_id: `file:${file.relativePath}`,
              message_index: chunk.chunkIndex,
              ref_id: refIdBase,
              tags: buildDocumentTags(file),
              source_metadata: sourceMetadata,
            };

            let existingMatches: Array<{ id: string }> = [];
            if (importPolicy === "skip_existing" || importPolicy === "overwrite_existing") {
              progressState.currentStage = "checking_existing";
              renderProgress();
              const existing = await gateway.getMemoryByRef(refIdBase, options.project);
              existingMatches = existing.map((item) => ({ id: item.id }));
            }

            if (importPolicy === "skip_existing") {
              if (existingMatches.length > 0) {
                increment(summary.skipReasons, "already_exists");
                summary.skippedChunks += 1;
                progressState.liveSkipped += 1;
                progressState.chunksCompleted += 1;
                progressState.currentFileChunksProcessed += 1;
                progressState.currentStage = "skipped";
                checkpoint.advance(
                  file.absolutePath,
                  checkpointKey,
                  processedCount + chunkOffset + 1
                );
                renderProgress();
                audit.writeEvent("message_skipped", {
                  file_path: file.absolutePath,
                  chunk_index: chunk.chunkIndex,
                  reason: "already_exists",
                });
                continue;
              }
            }

            if (importPolicy === "overwrite_existing" && existingMatches.length > 0 && !options.dryRun) {
              progressState.currentStage = "overwriting";
              renderProgress();
              if (!gateway.deleteMemoriesByIds) {
                throw new Error("overwrite_existing requires deleteMemoriesByIds gateway support.");
              }
              await gateway.deleteMemoriesByIds(existingMatches.map((item) => item.id));
              audit.writeEvent("message_stage_changed", {
                file_path: file.absolutePath,
                chunk_index: chunk.chunkIndex,
                stage: "overwritten",
                replaced_count: existingMatches.length,
                ref_id: refIdBase,
              });
            }

            progressState.currentStage = "saving";
            renderProgress();
            if (!options.dryRun) {
              await notifyImportStarted();
              progressState.currentStage = "embedding";
              renderProgress();
              await gateway.saveMemory(payload);
            }

            summary.importedChunks += 1;
            progressState.liveSaved += 1;
            progressState.chunksCompleted += 1;
            progressState.currentFileChunksProcessed += 1;
            progressState.currentStage = "checkpoint";
            checkpoint.advance(
              file.absolutePath,
              checkpointKey,
              processedCount + chunkOffset + 1
            );
            renderProgress();
            audit.writeEvent("message_imported", {
              file_path: file.absolutePath,
              chunk_index: chunk.chunkIndex,
              chunk_total: chunk.chunkTotal,
              ref_id: refIdBase,
              dry_run: Boolean(options.dryRun),
            });
          }

          audit.writeEvent("file_completed", {
            file_path: file.absolutePath,
          });
          progressState.filesCompleted += 1;
          progressState.currentStage = "completed";
          renderProgress();
          logWithProgress(
            `[document-import] completed file ${plan.fileIndex}/${filePlans.length}: ${file.relativePath} (${progressState.currentFileChunksProcessed}/${activeChunks.length} chunks)`
          );
        }

        audit.writeEvent("run_completed", {
          imported_chunks: summary.importedChunks,
          skipped_chunks: summary.skippedChunks,
          skipped_files: summary.skippedFiles,
          skip_reasons: summary.skipReasons,
        });
        return summary;
      } finally {
        await waitForBackgroundSaveTasks();
      }
    });
  } catch (error) {
    if (error instanceof ImportInterruptedError) {
      audit.writeEvent("run_interrupted", {
        imported_chunks: summary.importedChunks,
        skipped_chunks: summary.skippedChunks,
      });
      throw error;
    }

    audit.writeEvent("run_failed", {
      imported_chunks: summary.importedChunks,
      skipped_chunks: summary.skippedChunks,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    clearProgress();
    await audit.close();
  }
}

async function parseDocumentInputWithRustPreferred(
  absoluteInput: string,
  limits: IDocumentImportLimits,
  runtimeEnv: NodeJS.ProcessEnv | undefined,
  parseWithRust: (
    inputPath: string,
    limits: IDocumentImportLimits,
    env?: NodeJS.ProcessEnv
  ) => Promise<IRustDocumentEngineOutput>
): Promise<IRustDocumentEngineOutput> {
  try {
    return await parseWithRust(absoluteInput, limits, runtimeEnv ?? process.env);
  } catch (error) {
    console.warn(
      `[document-import] rust parser unavailable, falling back to TypeScript parser: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return parseDocumentInputWithTypeScriptFallback(absoluteInput, limits);
  }
}

async function parseDocumentInputWithTypeScriptFallback(
  absoluteInput: string,
  limits: IDocumentImportLimits
): Promise<IRustDocumentEngineOutput> {
  const discovered = await discoverSupportedFiles(absoluteInput);
  const files: IRustDocumentFileResult[] = [];

  for (const unsupported of discovered.unsupported) {
    files.push({
      path: unsupported.absolutePath,
      relative_path: unsupported.relativePath,
      extension: unsupported.extension,
      size_bytes: unsupported.sizeBytes,
      status: "skipped",
      reason: "unsupported_extension",
      chunks: [],
    });
  }

  for (const file of discovered.supported) {
    const skipReasonByLimits = validateFileAgainstLimits(file, limits);
    if (skipReasonByLimits) {
      files.push({
        path: file.absolutePath,
        relative_path: file.relativePath,
        extension: file.extension,
        size_bytes: file.sizeBytes,
        status: "skipped",
        reason: skipReasonByLimits,
        chunks: [],
      });
      continue;
    }

    const parsed = await parseDocumentFile(file, limits);
    if (parsed.reason) {
      files.push({
        path: file.absolutePath,
        relative_path: file.relativePath,
        extension: file.extension,
        size_bytes: file.sizeBytes,
        status: "skipped",
        reason: parsed.reason,
        chunks: [],
      });
      continue;
    }

    files.push({
      path: file.absolutePath,
      relative_path: file.relativePath,
      extension: file.extension,
      size_bytes: file.sizeBytes,
      status: "supported",
      reason: "parsed",
      chunks: parsed.chunks.map((chunk) => ({
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        chunk_total: chunk.chunkTotal,
      })),
    });
  }

  return {
    scan_summary: {
      discovered_files: discovered.totalFiles,
      supported_files: files.filter((file) => file.status === "supported").length,
      skipped_files: files.filter((file) => file.status === "skipped").length,
    },
    files,
  };
}

async function parseDocumentFile(
  file: IDiscoveredFile,
  limits: IDocumentImportLimits
): Promise<IParsedDocument> {
  const content = await readFile(file.absolutePath, "utf8");
  if (content.length > limits.max_chars_per_file) {
    return { chunks: [], reason: "file_exceeds_max_chars" };
  }

  if (file.extension === ".md" || file.extension === ".txt") {
    return {
      chunks: chunkText(content, limits.chunk_size, limits.chunk_overlap, limits.max_chunks_per_file),
    };
  }

  if (file.extension === ".json") {
    try {
      const parsed = JSON.parse(content) as unknown;
      const records = normalizeJsonRecords(parsed);
      return {
        chunks: recordsToChunks(records, limits.max_chunks_per_file),
      };
    } catch {
      return { chunks: [], reason: "invalid_json" };
    }
  }

  if (file.extension === ".jsonl" || file.extension === ".ndjson") {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const records: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        records.push(stringifyRecord(parsed));
      } catch {
        return { chunks: [], reason: "invalid_jsonl" };
      }
    }
    return {
      chunks: recordsToChunks(records, limits.max_chunks_per_file),
    };
  }

  if (file.extension === ".csv") {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return { chunks: [], reason: "empty_csv" };
    }
    const header = splitCsvLine(lines[0]);
    const records: string[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const values = splitCsvLine(lines[i]);
      const row: Record<string, string> = {};
      for (let column = 0; column < header.length; column += 1) {
        const key = header[column]?.trim() || `col_${column + 1}`;
        row[key] = values[column] ?? "";
      }
      records.push(JSON.stringify(row));
    }
    if (records.length === 0) {
      return { chunks: [], reason: "empty_csv" };
    }
    return {
      chunks: recordsToChunks(records, limits.max_chunks_per_file),
    };
  }

  return { chunks: [], reason: "unsupported_extension" };
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function normalizeJsonRecords(parsed: unknown): string[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => stringifyRecord(item));
  }
  if (parsed && typeof parsed === "object") {
    return [stringifyRecord(parsed)];
  }
  return [String(parsed ?? "")];
}

function stringifyRecord(record: unknown): string {
  if (typeof record === "string") {
    return record;
  }
  if (record && typeof record === "object") {
    return JSON.stringify(record);
  }
  return String(record ?? "");
}

function recordsToChunks(records: string[], maxChunksPerFile: number): IDocumentChunk[] {
  const limited = records.slice(0, maxChunksPerFile);
  return limited.map((record, index) => ({
    content: record,
    chunkIndex: index,
    chunkTotal: limited.length,
  }));
}

function chunkText(
  content: string,
  chunkSize: number,
  chunkOverlap: number,
  maxChunks: number
): IDocumentChunk[] {
  if (!content.trim()) {
    return [];
  }

  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(chunkOverlap, safeChunkSize - 1));
  const step = Math.max(1, safeChunkSize - safeOverlap);
  const chunks: IDocumentChunk[] = [];

  for (let start = 0; start < content.length && chunks.length < maxChunks; start += step) {
    const end = Math.min(content.length, start + safeChunkSize);
    const raw = content.slice(start, end).trim();
    if (!raw) {
      continue;
    }
    chunks.push({
      content: raw,
      chunkIndex: chunks.length,
      chunkTotal: 0,
    });
    if (end >= content.length) {
      break;
    }
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    chunkTotal: chunks.length,
  }));
}

async function discoverSupportedFiles(inputPath: string): Promise<{
  totalFiles: number;
  supported: IDiscoveredFile[];
  unsupported: Array<Omit<IDiscoveredFile, "chunks">>;
}> {
  const inputStat = await stat(inputPath);
  if (inputStat.isFile()) {
    const extension = normalizeExtension(inputPath);
    const supported = SUPPORTED_EXTENSIONS.has(extension)
      ? [{
          absolutePath: inputPath,
          relativePath: basename(inputPath),
          extension,
          sizeBytes: inputStat.size,
          chunks: [],
        }]
      : [];
    return {
      totalFiles: 1,
      supported,
      unsupported: supported.length === 0
        ? [{
            absolutePath: inputPath,
            relativePath: basename(inputPath),
            extension,
            sizeBytes: inputStat.size,
          }]
        : [],
    };
  }

  const allFiles: string[] = [];
  await walkFiles(inputPath, allFiles);
  const supported: IDiscoveredFile[] = [];
  const unsupported: Array<Omit<IDiscoveredFile, "chunks">> = [];
  for (const filePath of allFiles) {
    const extension = normalizeExtension(filePath);
    const fileStat = await stat(filePath);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      unsupported.push({
        absolutePath: filePath,
        relativePath: relative(inputPath, filePath) || basename(filePath),
        extension,
        sizeBytes: fileStat.size,
      });
      continue;
    }
    supported.push({
      absolutePath: filePath,
      relativePath: relative(inputPath, filePath) || basename(filePath),
      extension,
      sizeBytes: fileStat.size,
      chunks: [],
    });
  }

  return {
    totalFiles: allFiles.length,
    supported,
    unsupported,
  };
}

async function walkFiles(pathValue: string, out: string[]): Promise<void> {
  const entries = await readdir(pathValue, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(pathValue, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absolute, out);
      continue;
    }
    if (entry.isFile()) {
      out.push(absolute);
    }
  }
}

function validateFileAgainstLimits(
  file: IDiscoveredFile,
  limits: IDocumentImportLimits
): string | null {
  if (file.sizeBytes > limits.max_file_size_mb * 1024 * 1024) {
    return "file_exceeds_max_size";
  }
  return null;
}

function buildDocumentTags(file: IDiscoveredFile): string[] {
  const ext = file.extension.startsWith(".") ? file.extension.slice(1) : file.extension;
  return [
    "imported",
    "document-import",
    `file-type-${ext}`,
    `file-name-${sanitizeTagValue(basename(file.absolutePath))}`,
    `relative-path-${sanitizeTagValue(file.relativePath)}`,
  ];
}

function buildChunkContent(file: IDiscoveredFile, chunk: IDocumentChunk): string {
  return [
    `[Document Source]`,
    `filename: ${basename(file.absolutePath)}`,
    `source_path: ${file.absolutePath}`,
    `relative_path: ${file.relativePath}`,
    `source_type: ${file.extension.replace(/^\./, "")}`,
    `chunk_index: ${chunk.chunkIndex + 1}`,
    `chunk_total: ${chunk.chunkTotal}`,
    "",
    chunk.content,
  ].join("\n");
}

function buildDocumentRefId(filePath: string, chunkIndex: number, content: string): string {
  const hash = createHash("sha256")
    .update(`${filePath}:${chunkIndex}:${content}`)
    .digest("hex")
    .slice(0, 16);
  return `import:document:${hash}`;
}

function buildDocumentSourceMetadata(
  file: IDiscoveredFile,
  chunk: IDocumentChunk,
  project: string,
  refId: string
): ISourceMetadata {
  return {
    filename: basename(file.absolutePath),
    source_path: file.absolutePath,
    relative_path: file.relativePath,
    source_extension: file.extension.replace(/^\./, ""),
    chunk_index: chunk.chunkIndex + 1,
    chunk_total: chunk.chunkTotal,
    project,
    ref_id: refId,
  };
}

function buildDocumentCheckpointKey(filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  return `doc:${hash}`;
}

function parseEmbeddingDimension(
  value: string | undefined
): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function toDiscoveredFile(file: IRustDocumentFileResult): IDiscoveredFile {
  return {
    absolutePath: file.path,
    relativePath: file.relative_path,
    extension: file.extension,
    sizeBytes: file.size_bytes,
    chunks: file.chunks.map((chunk) => ({
      content: chunk.content,
      chunkIndex: chunk.chunk_index,
      chunkTotal: chunk.chunk_total,
    })),
  };
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function progressBar(current: number, total: number, width = 24): string {
  const useAsciiFallback =
    process.env.MEMORYMESH_PROGRESS_ASCII === "1"
    || process.env.MEMORYMESH_PROGRESS_ASCII === "true";
  const filledChar = useAsciiFallback ? "#" : "█";
  const emptyChar = useAsciiFallback ? "-" : "░";
  if (total <= 0) {
    return emptyChar.repeat(width);
  }
  const ratio = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(ratio * width);
  return `${filledChar.repeat(filled)}${emptyChar.repeat(width - filled)}`;
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

function truncateFileLabel(value: string, maxLength = 40): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function normalizeExtension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

function sanitizeTagValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/_-]/g, "-").slice(0, 60);
}

function resolveUserHomeDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home || !isAbsolute(home)) {
    throw new Error("Unable to resolve user home directory for document import config.");
  }
  return home;
}

async function resolveDocumentImportLimits(homeDir: string): Promise<IDocumentImportLimits> {
  const configPath = getMemoryMeshConfigPath(homeDir);
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as IRawConfig;
    const input = parsed.documentImportLimits;
    if (!input) {
      return { ...DEFAULT_LIMITS };
    }

    return {
      max_file_size_mb: toPositiveNumber(input.max_file_size_mb, DEFAULT_LIMITS.max_file_size_mb),
      max_chars_per_file: toPositiveNumber(input.max_chars_per_file, DEFAULT_LIMITS.max_chars_per_file),
      max_chunks_per_file: toPositiveNumber(input.max_chunks_per_file, DEFAULT_LIMITS.max_chunks_per_file),
      chunk_size: toPositiveNumber(input.chunk_size, DEFAULT_LIMITS.chunk_size),
      chunk_overlap: toNonNegativeNumber(input.chunk_overlap, DEFAULT_LIMITS.chunk_overlap),
    };
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

function toPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

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
