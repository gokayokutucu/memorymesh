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

const SUPPORTED_EXTENSIONS = new Set([".csv", ".json", ".jsonl", ".ndjson", ".md", ".txt"]);
const DEFAULT_LIMITS: IDocumentImportLimits = {
  max_file_size_mb: 5,
  max_chars_per_file: 100000,
  max_chunks_per_file: 200,
  chunk_size: 1200,
  chunk_overlap: 150,
};

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

export async function importDocumentsFromPath(
  inputPath: string,
  options: IDocumentImportOptions
): Promise<IDocumentImportSummary> {
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

  const discovered = await discoverSupportedFiles(absoluteInput);
  const summary: IDocumentImportSummary = {
    inputPath: absoluteInput,
    discoveredFiles: discovered.totalFiles,
    supportedFiles: discovered.supported.length,
    skippedFiles: discovered.totalFiles - discovered.supported.length,
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
    await options.onImportStarted?.();
  };

  const onSignal = (): void => {
    cancellationToken.cancel();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    if (!options.dryRun) {
      await withRuntimeEnv(options.runtimeEnv, async () => {
        await ensureEmbeddingModelAvailable();
      });
    }

    const gateway = createRuntimeImporterGateway(cancellationToken);

    for (let fileIndex = 0; fileIndex < discovered.supported.length; fileIndex += 1) {
      cancellationToken.throwIfCancelled();
      const file = discovered.supported[fileIndex];
      const skipReasonByLimits = validateFileAgainstLimits(file, limits);
      if (skipReasonByLimits) {
        increment(summary.skipReasons, skipReasonByLimits);
        summary.skippedFiles += 1;
        audit.writeEvent("warning", {
          file_path: file.absolutePath,
          reason: skipReasonByLimits,
        });
        continue;
      }

      const parsed = await parseDocumentFile(file, limits);
      if (parsed.reason) {
        summary.skippedFiles += 1;
        increment(summary.skipReasons, parsed.reason);
        audit.writeEvent("warning", {
          file_path: file.absolutePath,
          reason: parsed.reason,
        });
        continue;
      }

      const checkpointKey = buildDocumentCheckpointKey(file.absolutePath);
      const processedCount = checkpoint.getProcessedCount(file.absolutePath, checkpointKey);
      if (processedCount > 0) {
        summary.resumed = true;
      }
      const activeChunks = parsed.chunks.slice(processedCount);
      if (activeChunks.length === 0) {
        continue;
      }

      audit.writeEvent("file_started", {
        file_path: file.absolutePath,
        relative_path: file.relativePath,
        extension: file.extension,
        file_index: fileIndex + 1,
        file_total: discovered.supported.length,
        chunk_total: parsed.chunks.length,
      });
      console.log(
        `[document-import] file ${fileIndex + 1}/${discovered.supported.length}: ${file.relativePath} (${activeChunks.length} chunk(s) pending)`
      );

      for (let chunkOffset = 0; chunkOffset < activeChunks.length; chunkOffset += 1) {
        cancellationToken.throwIfCancelled();
        const chunk = activeChunks[chunkOffset];
        const refIdBase = buildDocumentRefId(file.absolutePath, chunk.chunkIndex, chunk.content);
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
        };

        if (importPolicy === "overwrite_existing") {
          increment(summary.skipReasons, "overwrite_existing_not_supported");
          summary.skippedChunks += 1;
          checkpoint.advance(
            file.absolutePath,
            checkpointKey,
            processedCount + chunkOffset + 1
          );
          audit.writeEvent("message_skipped", {
            file_path: file.absolutePath,
            chunk_index: chunk.chunkIndex,
            reason: "overwrite_existing_not_supported",
          });
          continue;
        }

        if (importPolicy === "skip_existing") {
          const existing = await withRuntimeEnv(options.runtimeEnv, async () =>
            gateway.getMemoryByRef(refIdBase, options.project)
          );
          if (existing.length > 0) {
            increment(summary.skipReasons, "already_exists");
            summary.skippedChunks += 1;
            checkpoint.advance(
              file.absolutePath,
              checkpointKey,
              processedCount + chunkOffset + 1
            );
            audit.writeEvent("message_skipped", {
              file_path: file.absolutePath,
              chunk_index: chunk.chunkIndex,
              reason: "already_exists",
            });
            continue;
          }
        }

        if (!options.dryRun) {
          await notifyImportStarted();
          await withRuntimeEnv(options.runtimeEnv, async () => {
            await gateway.saveMemory(payload);
          });
        }

        summary.importedChunks += 1;
        checkpoint.advance(
          file.absolutePath,
          checkpointKey,
          processedCount + chunkOffset + 1
        );
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
    }

    audit.writeEvent("run_completed", {
      imported_chunks: summary.importedChunks,
      skipped_chunks: summary.skippedChunks,
      skipped_files: summary.skippedFiles,
      skip_reasons: summary.skipReasons,
    });
    return summary;
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
    await waitForBackgroundSaveTasks();
    await audit.close();
  }
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

async function discoverSupportedFiles(inputPath: string): Promise<{ totalFiles: number; supported: IDiscoveredFile[] }> {
  const inputStat = await stat(inputPath);
  if (inputStat.isFile()) {
    const extension = normalizeExtension(inputPath);
    const supported = SUPPORTED_EXTENSIONS.has(extension)
      ? [{
          absolutePath: inputPath,
          relativePath: basename(inputPath),
          extension,
          sizeBytes: inputStat.size,
        }]
      : [];
    return {
      totalFiles: 1,
      supported,
    };
  }

  const allFiles: string[] = [];
  await walkFiles(inputPath, allFiles);
  const supported: IDiscoveredFile[] = [];
  for (const filePath of allFiles) {
    const extension = normalizeExtension(filePath);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      continue;
    }
    const fileStat = await stat(filePath);
    supported.push({
      absolutePath: filePath,
      relativePath: relative(inputPath, filePath) || basename(filePath),
      extension,
      sizeBytes: fileStat.size,
    });
  }

  return {
    totalFiles: allFiles.length,
    supported,
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

function buildDocumentCheckpointKey(filePath: string): string {
  const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  return `doc:${hash}`;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
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
