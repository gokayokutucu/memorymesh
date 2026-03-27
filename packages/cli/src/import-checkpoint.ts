import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { IGptConversation, IImportPolicy } from "@memorymesh/core";
import { resolveUserHomeDir } from "./system/runtime-home";

const CHECKPOINT_VERSION = 1;

export interface ICheckpointContext {
  input_path: string;
  project: string;
  engine: "ts" | "rust";
  import_policy: IImportPolicy;
  execution_mode: "dry_run" | "real";
  import_kind: "gpt" | "document";
  embedding_mode?: string;
  embedding_model?: string;
  embedding_dimension?: number;
}

interface ICheckpointConversationState {
  processed_message_count: number;
  updated_at: string;
}

interface ICheckpointFileState {
  conversations: Record<string, ICheckpointConversationState>;
}

interface ICheckpointData {
  version: number;
  dataset_key: string;
  context: ICheckpointContext;
  created_at: string;
  updated_at: string;
  files: Record<string, ICheckpointFileState>;
}

export interface IImportCheckpointState {
  enabled: boolean;
  resumed: boolean;
  path?: string;
  reset: boolean;
  mode: "dry_run" | "real";
}

export class ImportCheckpoint {
  private readonly enabled: boolean;
  private readonly datasetKey: string;
  private readonly filePath: string;
  private data: ICheckpointData;
  private resumed = false;
  private readonly reset: boolean;

  constructor(context: ICheckpointContext, options?: { enabled?: boolean; reset?: boolean }) {
    this.enabled = options?.enabled ?? true;
    this.reset = options?.reset ?? false;
    this.datasetKey = buildDatasetKey(context);
    this.filePath = resolveCheckpointFilePath(
      this.datasetKey,
      context.execution_mode,
      context.import_kind
    );
    this.data = createEmptyCheckpoint(context, this.datasetKey);

    if (!this.enabled) {
      return;
    }

    if (this.reset) {
      safeRemoveFile(this.filePath);
      this.persist();
      return;
    }

    const loaded = loadCheckpointFile(this.filePath);
    if (loaded && isCheckpointCompatible(loaded, this.datasetKey)) {
      this.data = loaded;
      this.resumed = hasAnyProgress(loaded);
      return;
    }
    this.persist();
  }

  getState(): IImportCheckpointState {
    return {
      enabled: this.enabled,
      resumed: this.resumed,
      path: this.enabled ? this.filePath : undefined,
      reset: this.reset,
      mode: this.data.context.execution_mode,
    };
  }

  getProcessedCount(filePath: string, conversationKey: string): number {
    if (!this.enabled) {
      return 0;
    }
    const file = this.data.files[filePath];
    if (!file) {
      return 0;
    }
    return file.conversations[conversationKey]?.processed_message_count ?? 0;
  }

  advance(filePath: string, conversationKey: string, nextMessageCount: number): void {
    if (!this.enabled) {
      return;
    }
    const safeCount = Math.max(0, Math.floor(nextMessageCount));
    const file = ensureFileState(this.data, filePath);
    const existing = file.conversations[conversationKey];
    if (existing && existing.processed_message_count >= safeCount) {
      return;
    }

    file.conversations[conversationKey] = {
      processed_message_count: safeCount,
      updated_at: new Date().toISOString(),
    };
    this.data.updated_at = new Date().toISOString();
    this.persist();
  }

  private persist(): void {
    if (!this.enabled) {
      return;
    }
    writeCheckpointFile(this.filePath, this.data);
  }
}

export function buildConversationCheckpointKey(
  conversation: IGptConversation,
  conversationIndex: number
): string {
  const sourceId = conversation.source_conversation_id?.trim();
  if (sourceId) {
    return `source:${normalizeText(sourceId)}`;
  }
  return `title:${hashShort(normalizeText(conversation.title))}:index:${conversationIndex}`;
}

export function resolveCheckpointFilePath(
  datasetKey: string,
  mode: ICheckpointContext["execution_mode"],
  importKind: ICheckpointContext["import_kind"]
): string {
  const directory = resolve(
    process.env.MEMORYMESH_CHECKPOINT_DIR ??
      join(resolveUserHomeDir(process.platform, process.env), ".memorymesh", "checkpoints")
  );
  const prefix = importKind === "document" ? "document-import" : "gpt-import";
  return join(directory, `${prefix}-${mode.replace("_", "-")}-${datasetKey}.json`);
}

function buildDatasetKey(context: ICheckpointContext): string {
  const normalizedPath = normalizeText(resolve(context.input_path));
  const payload = JSON.stringify({
    v: CHECKPOINT_VERSION,
    path: normalizedPath,
    project: context.project,
    engine: context.engine,
    policy: context.import_policy,
    mode: context.execution_mode,
    import_kind: context.import_kind,
    embedding_mode: normalizeOptionalText(context.embedding_mode),
    embedding_model: normalizeOptionalText(context.embedding_model),
    embedding_dimension: normalizeOptionalNumber(context.embedding_dimension),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

function createEmptyCheckpoint(
  context: ICheckpointContext,
  datasetKey: string
): ICheckpointData {
  const now = new Date().toISOString();
  return {
    version: CHECKPOINT_VERSION,
    dataset_key: datasetKey,
    context,
    created_at: now,
    updated_at: now,
    files: {},
  };
}

function ensureFileState(data: ICheckpointData, filePath: string): ICheckpointFileState {
  if (!data.files[filePath]) {
    data.files[filePath] = { conversations: {} };
  }
  return data.files[filePath];
}

function loadCheckpointFile(filePath: string): ICheckpointData | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ICheckpointData;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.dataset_key !== "string" ||
      typeof parsed.version !== "number" ||
      typeof parsed.files !== "object" ||
      parsed.files === null
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCheckpointFile(filePath: string, data: ICheckpointData): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tempPath, filePath);
}

function safeRemoveFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // best-effort cleanup only
  }
}

function isCheckpointCompatible(
  data: ICheckpointData,
  datasetKey: string
): boolean {
  return data.version === CHECKPOINT_VERSION && data.dataset_key === datasetKey;
}

function hasAnyProgress(data: ICheckpointData): boolean {
  for (const file of Object.values(data.files)) {
    for (const conversation of Object.values(file.conversations)) {
      if (conversation.processed_message_count > 0) {
        return true;
      }
    }
  }
  return false;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? normalizeText(trimmed) : null;
}

function normalizeOptionalNumber(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
