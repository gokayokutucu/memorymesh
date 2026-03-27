import { IGptMessage, IRawMappingNode } from "./types";

const SKIPPED_CONTENT_TYPES = new Set([
  "code",
  "execution_output",
  "tether_browsing_display",
]);

export function toImportableMessage(node: IRawMappingNode): IGptMessage | null {
  const message = node.message;
  if (!message) {
    return null;
  }

  const role = typeof message.author?.role === "string"
    ? message.author.role
    : "unknown";
  const contentType = typeof message.content?.content_type === "string"
    ? message.content.content_type
    : "text";
  if (SKIPPED_CONTENT_TYPES.has(contentType)) {
    return null;
  }

  const parts = Array.isArray(message.content?.parts)
    ? message.content.parts.filter((part): part is string => typeof part === "string")
    : [];
  const content = parts.join("\n").trim();
  if (content.length === 0) {
    return null;
  }

  return {
    id: node.id,
    role,
    content_type: contentType,
    content,
    create_time: typeof message.create_time === "number" ? message.create_time : undefined,
  };
}

export function isImportableRole(role: string): boolean {
  return role === "assistant" || role === "user";
}
