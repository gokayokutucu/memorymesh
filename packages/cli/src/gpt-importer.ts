import {
  ICancellationToken,
  classifyMessage as classifyMessageShared,
  IImportCallbacks,
  IImportPolicy,
  IImportResult,
  IImporterGateway,
  IGptConversation,
  IGptMessage,
  ISearchResult,
  parseConversations as parseConversationsShared,
  importConversations as runImportConversations,
  ISaveMemoryInput,
} from "@memorymesh/core";
import {
  createRuntimeImporterGateway,
  ensureEmbeddingModelAvailable,
} from "@memorymesh/runtime";

interface IMcpToolResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  error?: unknown;
}

export interface IImportRunOptions {
  delayMs?: number;
  verbose?: boolean;
  importPolicy?: IImportPolicy;
  gateway?: IImporterGateway;
  callbacks?: Partial<IImportCallbacks>;
  showConversationProgress?: boolean;
  cancellationToken?: ICancellationToken;
}

export interface IImportRunResult {
  totalConversations: number;
  saved: number;
  skipped: number;
  skippedReasons: Record<string, number>;
}

const MCP_ENDPOINT = process.env.MEMORYMESH_MCP_URL ?? "http://localhost:3456/mcp";
const IMPORT_GATEWAY_MODE = process.env.MEMORYMESH_IMPORT_GATEWAY_MODE ?? "local";

export function parseConversations(raw: string): IGptConversation[] {
  return parseConversationsShared(raw);
}

export function classifyMessage(
  msg: IGptMessage,
  title: string,
  project: string
): ISaveMemoryInput {
  return classifyMessageShared(msg, title, project);
}

export async function importConversations(
  conversations: IGptConversation[],
  project: string,
  dryRun: boolean,
  options: IImportRunOptions = {}
): Promise<IImportRunResult> {
  const delayMs = options.delayMs ?? 3000;
  const verbose = options.verbose ?? false;
  const showConversationProgress = options.showConversationProgress ?? true;
  const importPolicy = options.importPolicy ?? "skip_existing";
  const externalCallbacks = options.callbacks;
  const progressState: {
    active: boolean;
    current: number;
    total: number;
    title: string;
    messageCount: number;
    startTimeMs: number;
    lineRendered: boolean;
    lastLineLength: number;
  } = {
    active: false,
    current: 0,
    total: conversations.length,
    title: "",
    messageCount: 0,
    startTimeMs: 0,
    lineRendered: false,
    lastLineLength: 0,
  };

  const writeProgress = (value: string): void => {
    process.stdout.write(value);
  };

  const renderProgressBar = (
    current: number,
    total: number,
    title: string,
    messageCount: number
  ): void => {
    if (!showConversationProgress) {
      return;
    }
    if (total <= 0) {
      return;
    }
    const width = 24;
    const ratio = Math.min(Math.max(current / total, 0), 1);
    const filled = Math.round(width * ratio);
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const trimmedTitle = truncateTitle(title, 44);
    const eta = formatEta(progressState.startTimeMs, current, total);
    const line = `[progress] [${bar}] ${current}/${total} conv | ${trimmedTitle} (${messageCount} msg) | ETA ${eta}`;
    const paddedLine = line.padEnd(progressState.lastLineLength, " ");
    writeProgress(`\r${paddedLine}`);
    progressState.lastLineLength = paddedLine.length;
    progressState.lineRendered = true;
  };

  const finishProgressLine = (): void => {
    if (!showConversationProgress) {
      return;
    }
    if (!progressState.lineRendered) {
      return;
    }
    writeProgress(`\r${" ".repeat(progressState.lastLineLength)}\r`);
    writeProgress("\n");
    progressState.lineRendered = false;
    progressState.lastLineLength = 0;
  };

  const logWithProgress = (line: string): void => {
    if (!showConversationProgress) {
      console.log(line);
      return;
    }
    finishProgressLine();
    console.log(line);
    if (progressState.active) {
      renderProgressBar(
        progressState.current,
        progressState.total,
        progressState.title,
        progressState.messageCount
      );
    }
  };

  const gateway =
    options.gateway ??
    (IMPORT_GATEWAY_MODE === "remote"
      ? createMcpImporterGateway()
      : createRuntimeImporterGateway(options.cancellationToken));

  const usesLocalRuntimeGateway = !options.gateway && IMPORT_GATEWAY_MODE !== "remote";
  if (!dryRun && usesLocalRuntimeGateway) {
    await ensureEmbeddingModelAvailable();
  }

  const callbacks: IImportCallbacks = {
    onConversationStart(context): void {
      progressState.active = true;
      progressState.current = context.conversation_index;
      progressState.total = context.total_conversations;
      progressState.title = context.title;
      progressState.messageCount = context.message_count;
      if (progressState.startTimeMs === 0) {
        progressState.startTimeMs = Date.now();
      }
      renderProgressBar(
        progressState.current,
        progressState.total,
        progressState.title,
        progressState.messageCount
      );
      externalCallbacks?.onConversationStart?.(context);
    },
    onMessageImported(context): void {
      externalCallbacks?.onMessageImported?.(context);
      if (!verbose) {
        return;
      }
      logWithProgress(
        formatDryRunLine({
          conversationTitle: context.conversation_title,
          messageIndex: context.message_index,
          role: context.role,
          memoryType: context.memory_type,
          refId: context.ref_id,
          preview: context.preview,
          status: dryRun ? "IMPORT" : "SAVED",
        })
      );
    },
    onMessageSkipped(context): void {
      externalCallbacks?.onMessageSkipped?.(context);
      if (!verbose) {
        return;
      }
      logWithProgress(
        formatDryRunLine({
          conversationTitle: context.conversation_title,
          messageIndex: context.message_index,
          role: context.role,
          memoryType: "-",
          refId: context.ref_id,
          payloadBytes: context.payload_bytes,
          preview: context.preview,
          status: "SKIP",
          reason: context.reason,
        })
      );
    },
    onConversationComplete(context): void {
      progressState.current = context.conversation_index;
      progressState.title = context.title;
      renderProgressBar(
        progressState.current,
        progressState.total,
        progressState.title,
        progressState.messageCount
      );
      if (context.conversation_index >= context.total_conversations) {
        progressState.active = false;
        finishProgressLine();
      }
      externalCallbacks?.onConversationComplete?.(context);
    },
    onMessageStart(context): void {
      externalCallbacks?.onMessageStart?.(context);
    },
    onMessageStageChange(context): void {
      externalCallbacks?.onMessageStageChange?.(context);
    },
  };

  let result: IImportResult;
  try {
    result = await runImportConversations(
      conversations,
      project,
      dryRun,
      gateway,
      {
        import_policy: importPolicy,
        conversation_delay_ms: delayMs,
        callbacks,
        cancellation_token: options.cancellationToken,
      }
    );
  } finally {
    if (!dryRun && usesLocalRuntimeGateway) {
      await waitForRuntimeBackgroundSaveTasks();
    }
  }

  return {
    totalConversations: result.total_conversations,
    saved: result.saved,
    skipped: result.skipped,
    skippedReasons: result.skipped_reasons,
  };
}

async function waitForRuntimeBackgroundSaveTasks(): Promise<void> {
  const runtime = (await import("@memorymesh/runtime")) as {
    waitForBackgroundSaveTasks?: () => Promise<void>;
  };
  if (typeof runtime.waitForBackgroundSaveTasks === "function") {
    await runtime.waitForBackgroundSaveTasks();
  }
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatEta(startTimeMs: number, current: number, total: number): string {
  if (startTimeMs <= 0 || current <= 0 || total <= 0) {
    return "--:--";
  }
  const elapsedMs = Date.now() - startTimeMs;
  if (elapsedMs <= 0) {
    return "--:--";
  }
  const estimatedTotalMs = (elapsedMs / current) * total;
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
  const seconds = Math.round(remainingMs / 1000);
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

async function callMcpSaveTool(payload: ISaveMemoryInput): Promise<void> {
  const response = await callMcpTool("save_memory", payload);
  if (response.error) {
    throw new Error(`MCP save_memory call returned an error payload: ${JSON.stringify(response.error)}`);
  }
}

function createMcpImporterGateway(): IImporterGateway {
  return {
    async saveMemory(payload: ISaveMemoryInput): Promise<void> {
      await callMcpSaveTool(payload);
    },
    async getMemoryByRef(
      refId: string,
      projectName?: string
    ): Promise<ISearchResult[]> {
      return callMcpGetMemoryByRefTool(refId, projectName);
    },
  };
}

async function callMcpGetMemoryByRefTool(
  refId: string,
  project?: string
): Promise<ISearchResult[]> {
  const response = await callMcpTool("get_memory_by_ref", {
    ref_id: refId,
    project,
  });

  if (response.error) {
    throw new Error(`MCP get_memory_by_ref call returned an error payload: ${JSON.stringify(response.error)}`);
  }

  return parseGetMemoryByRefStructuredResult(response.result?.structuredContent);
}

async function callMcpTool(name: string, args: object): Promise<IMcpToolResponse> {
  const body = {
    jsonrpc: "2.0",
    id: `${Date.now()}`,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  };

  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`MCP ${name} call failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as IMcpToolResponse;
  }

  const text = await response.text();
  return {
    result: {
      content: [{ type: "text", text }],
    },
  };
}

function formatDryRunLine(input: {
  conversationTitle: string;
  messageIndex: number;
  role: string;
  memoryType: string;
  refId?: string;
  payloadBytes?: number;
  preview: string;
  status: "IMPORT" | "SKIP" | "SAVED";
  reason?: string;
}): string {
  const contextParts = [
    `title=${input.conversationTitle}`,
    `msg_index=${input.messageIndex}`,
    `role=${input.role}`,
    input.refId ? `ref_id=${input.refId}` : "",
    typeof input.payloadBytes === "number" ? `payload_bytes=${input.payloadBytes}` : "",
  ].filter((part) => part.length > 0);
  const reasonPart = input.reason ? ` | reason=${input.reason}` : "";
  return `[dry-run] ${input.status} | ${contextParts.join(" | ")} | memory_type=${input.memoryType}${reasonPart}\n  preview: ${input.preview}`;
}

function parseGetMemoryByRefStructuredResult(
  structuredContent: unknown
): ISearchResult[] {
  if (!isRecord(structuredContent)) {
    return [];
  }
  const rawMemories = structuredContent.memories;
  if (!Array.isArray(rawMemories)) {
    return [];
  }
  const results: ISearchResult[] = [];
  for (const memory of rawMemories) {
    if (!isRecord(memory)) {
      continue;
    }

    const id = memory.id;
    const ref = memory.ref_id;
    if (typeof id !== "string" || typeof ref !== "string" || ref.length === 0) {
      continue;
    }

    results.push({
      id,
      content: "",
      project: typeof memory.project === "string" ? memory.project : "general",
      memory_type: normalizeMemoryType(
        typeof memory.memory_type === "string" ? memory.memory_type : undefined
      ),
      semantic_score: 1,
      similarity_score: 1,
      created_at:
        typeof memory.created_at === "string"
          ? memory.created_at
          : new Date().toISOString(),
      ref_id: ref,
      source_type: normalizeSourceType(
        typeof memory.source_type === "string" ? memory.source_type : undefined
      ),
    });
  }

  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMemoryType(value: string | undefined): ISearchResult["memory_type"] {
  if (
    value === "decision" ||
    value === "learning" ||
    value === "context" ||
    value === "preference" ||
    value === "output"
  ) {
    return value;
  }
  return "context";
}

function normalizeSourceType(value: string | undefined): ISearchResult["source_type"] {
  if (
    value === "code_block" ||
    value === "email" ||
    value === "document" ||
    value === "plan" ||
    value === "summary" ||
    value === "imported_conversation"
  ) {
    return value;
  }
  return undefined;
}
