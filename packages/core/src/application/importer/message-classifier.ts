import { createHash } from "node:crypto";
import { ISaveMemoryInput } from "../../types";
import { IImportClassifyContext, IImportEvaluation, IGptMessage } from "./types";
import { isImportableRole } from "./message-filter";

export function classifyMessage(
  msg: IGptMessage,
  title: string,
  project: string,
  context: IImportClassifyContext = {}
): ISaveMemoryInput {
  const lower = msg.content.toLowerCase();
  const role = msg.role.toLowerCase();
  let memoryType: ISaveMemoryInput["memory_type"] = "context";

  if (role === "assistant") {
    if (isCodeLikeContent(msg.content)) {
      memoryType = "output";
    } else if (isDecisionLikeContent(lower)) {
      memoryType = "decision";
    } else if (isLearningLikeContent(lower)) {
      memoryType = "learning";
    } else {
      memoryType = "context";
    }
  } else if (role === "user") {
    memoryType = "context";
  }

  const sourceAgent = "chatgpt";
  const sourceFormat = "gpt_export";
  const createdAt = toIsoTimestamp(msg.create_time);
  const messageIndex = context.message_index;
  const refId = buildStableImportedRefId({
    sourceAgent,
    sourceFormat,
    conversationTitle: title,
    sourceConversationId: context.source_conversation_id,
    messageIndex,
    content: msg.content,
  });

  return {
    content: msg.content,
    project,
    memory_type: memoryType,
    created_at: createdAt,
    conversation_id: context.source_conversation_id,
    source_agent: sourceAgent,
    source_format: sourceFormat,
    message_index: messageIndex,
    title,
    ref_id: refId,
    tags: mergeImporterTags(extractTags(msg.content), sourceAgent, sourceFormat),
    source_type: memoryType === "output" ? inferOutputSourceType(msg.content) : "summary",
  };
}

export function evaluateMessageForImport(
  msg: IGptMessage,
  title: string,
  project: string,
  context: IImportClassifyContext = {}
): IImportEvaluation {
  if (!isImportableRole(msg.role)) {
    return {
      importable: false,
      skip_reason: `unsupported_role:${msg.role}`,
    };
  }

  return {
    importable: true,
    payload: classifyMessage(msg, title, project, context),
  };
}

function isCodeLikeContent(content: string): boolean {
  return /```|~~~|\b(function|class|interface|type|const|let|var|SELECT|MATCH)\b/i.test(content);
}

function isDecisionLikeContent(lower: string): boolean {
  return /\b(decision|decide|decided|chosen|we will use|tradeoff|adopt)\b/i.test(lower);
}

function isLearningLikeContent(lower: string): boolean {
  return /\b(learned|lesson|bug|root cause|postmortem|retrospective|fix)\b/i.test(lower);
}

function inferOutputSourceType(content: string): "code_block" | "document" {
  return isCodeLikeContent(content) ? "code_block" : "document";
}

function extractTags(content: string): string[] {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);

  const stopwords = new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "will",
    "your",
    "about",
    "there",
    "would",
    "could",
    "should",
    "using",
    "when",
    "where",
  ]);

  const unique: string[] = [];
  for (const word of words) {
    if (stopwords.has(word)) {
      continue;
    }
    if (!unique.includes(word)) {
      unique.push(word);
    }
    if (unique.length >= 6) {
      break;
    }
  }

  return unique;
}

function mergeImporterTags(
  baseTags: string[],
  sourceAgent: string,
  sourceFormat: string
): string[] {
  const merged = [...baseTags, "imported", "gpt-export", `source-agent-${sourceAgent}`, `source-format-${sourceFormat}`];
  return [...new Set(merged)];
}

function buildStableImportedRefId(input: {
  sourceAgent: string;
  sourceFormat: string;
  conversationTitle: string;
  sourceConversationId?: string;
  messageIndex?: number;
  content: string;
}): string {
  const normalizedTitle = normalizeText(input.conversationTitle);
  const normalizedContent = normalizeText(input.content);
  const titleHash = hashShort(normalizedTitle);
  const contentHash = hashShort(normalizedContent);
  const conversationPart = input.sourceConversationId
    ? normalizeText(input.sourceConversationId)
    : titleHash;
  const indexPart = input.messageIndex ?? -1;

  return `import:${input.sourceAgent}:${input.sourceFormat}:${conversationPart}:${indexPart}:${contentHash}`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function toIsoTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return undefined;
  }
  const millis = value > 1e12 ? value : value * 1000;
  return new Date(millis).toISOString();
}
