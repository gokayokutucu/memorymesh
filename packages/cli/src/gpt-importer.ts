import {
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
}

export interface IImportRunResult {
  totalConversations: number;
  saved: number;
  skipped: number;
  skippedReasons: Record<string, number>;
}

const MCP_ENDPOINT = process.env.MEMORYMESH_MCP_URL ?? "http://localhost:3456/mcp";

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
  const importPolicy = options.importPolicy ?? "skip_existing";

  const gateway: IImporterGateway = {
    async saveMemory(payload: ISaveMemoryInput): Promise<void> {
      await callMcpSaveTool(payload);
    },
    async getMemoryByRef(refId: string, projectName?: string): Promise<ISearchResult[]> {
      return callMcpGetMemoryByRefTool(refId, projectName);
    },
  };

  const callbacks: IImportCallbacks = {
    onConversationStart(context): void {
      console.log(
        `Importing conv ${context.conversation_index}/${context.total_conversations}: ${context.title} (${context.message_count} msg)`
      );
    },
    onMessageImported(context): void {
      if (!dryRun && !verbose) {
        return;
      }
      console.log(
        formatDryRunLine({
          role: context.role,
          memoryType: context.memory_type,
          preview: context.preview,
          status: dryRun ? "IMPORT" : "SAVED",
        })
      );
    },
    onMessageSkipped(context): void {
      if (!dryRun && !verbose) {
        return;
      }
      console.log(
        formatDryRunLine({
          role: context.role,
          memoryType: "-",
          preview: context.preview,
          status: "SKIP",
          reason: context.reason,
        })
      );
    },
  };

  const result: IImportResult = await runImportConversations(
    conversations,
    project,
    dryRun,
    gateway,
    {
      import_policy: importPolicy,
      conversation_delay_ms: delayMs,
      callbacks,
    }
  );

  return {
    totalConversations: result.total_conversations,
    saved: result.saved,
    skipped: result.skipped,
    skippedReasons: result.skipped_reasons,
  };
}

async function callMcpSaveTool(payload: ISaveMemoryInput): Promise<void> {
  const response = await callMcpTool("save_memory", payload);
  if (response.error) {
    throw new Error(`MCP save_memory call returned an error payload: ${JSON.stringify(response.error)}`);
  }
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
  role: string;
  memoryType: string;
  preview: string;
  status: "IMPORT" | "SKIP" | "SAVED";
  reason?: string;
}): string {
  const reasonPart = input.reason ? ` | reason=${input.reason}` : "";
  return `[dry-run] ${input.status} | role=${input.role} | memory_type=${input.memoryType}${reasonPart}\n  preview: ${input.preview}`;
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
