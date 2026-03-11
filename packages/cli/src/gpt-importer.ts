import { ISaveMemoryInput } from "@memorymesh/core";

export interface IGptMessage {
  role: string;
  content: string;
  create_time?: number;
}

export interface IGptConversation {
  title: string;
  messages: IGptMessage[];
}

interface IMcpToolResponse {
  result?: unknown;
  error?: unknown;
}

const MCP_ENDPOINT = process.env.MEMORYMESH_MCP_URL ?? "http://localhost:3456/mcp";

export function parseConversations(raw: string): IGptConversation[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((entry) => {
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : "Untitled";
    const mapping =
      item.mapping && typeof item.mapping === "object"
        ? (item.mapping as Record<string, unknown>)
        : {};

    const messages = Object.values(mapping)
      .map((node): IGptMessage | null => {
        const nodeObj = node as Record<string, unknown>;
        const message = nodeObj.message as Record<string, unknown> | undefined;
        if (!message) {
          return null;
        }

        const author = message.author as Record<string, unknown> | undefined;
        const role = typeof author?.role === "string" ? author.role : "unknown";

        const contentObj = message.content as Record<string, unknown> | undefined;
        const parts = Array.isArray(contentObj?.parts)
          ? contentObj?.parts.filter((part): part is string => typeof part === "string")
          : [];
        const content = parts.join("\n").trim();

        if (content.length === 0) {
          return null;
        }

        return {
          role,
          content,
          create_time:
            typeof message.create_time === "number" ? message.create_time : undefined,
        };
      })
      .filter((msg): msg is IGptMessage => msg !== null)
      .sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));

    return { title, messages };
  });
}

export function classifyMessage(
  msg: IGptMessage,
  title: string,
  project: string
): ISaveMemoryInput {
  const lower = msg.content.toLowerCase();
  let memory_type: ISaveMemoryInput["memory_type"] = "context";

  if (msg.role === "assistant" && /```|~~~|function|class|select\s+|match\s+\(/i.test(msg.content)) {
    memory_type = "output";
  } else if (/prefer|always|never|usually|workflow/i.test(lower)) {
    memory_type = "preference";
  } else if (/decide|decision|chosen|we will use|tradeoff/i.test(lower)) {
    memory_type = "decision";
  } else if (/learned|lesson|bug|root cause|fix/i.test(lower)) {
    memory_type = "learning";
  }

  const tags = extractTags(msg.content);

  return {
    content: msg.content,
    project,
    memory_type,
    title,
    tags,
    source_type: memory_type === "output" ? "document" : "summary",
  };
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

async function callMcpSaveTool(payload: ISaveMemoryInput): Promise<IMcpToolResponse> {
  const body = {
    jsonrpc: "2.0",
    id: `${Date.now()}`,
    method: "tools/call",
    params: {
      name: "save_memory",
      arguments: payload,
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
    throw new Error(`MCP save_memory call failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as IMcpToolResponse;
  }

  const text = await response.text();
  return { result: text };
}

export async function importConversations(
  conversations: IGptConversation[],
  project: string,
  dryRun: boolean
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== "assistant" && message.role !== "user") {
        skipped += 1;
        continue;
      }

      const payload = classifyMessage(message, conversation.title, project);

      if (dryRun) {
        saved += 1;
        continue;
      }

      await callMcpSaveTool(payload);
      saved += 1;
    }
  }

  return { saved, skipped };
}
