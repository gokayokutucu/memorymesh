import { normalizeMapping, reconstructOrderedNodes } from "./gpt-traversal";
import { toImportableMessage } from "./message-filter";
import { IGptConversation, IRawConversation } from "./types";

export function parseConversations(raw: string): IGptConversation[] {
  const parsed = JSON.parse(raw) as unknown;
  const records = Array.isArray(parsed) ? parsed : [];

  return records.map((record) => parseConversationRecord(record as IRawConversation));
}

function parseConversationRecord(record: IRawConversation): IGptConversation {
  const title = typeof record.title === "string" ? record.title : "Untitled";
  const sourceConversationId =
    typeof record.id === "string"
      ? record.id
      : typeof record.conversation_id === "string"
        ? record.conversation_id
        : undefined;
  const mapping = normalizeMapping(record.mapping);
  const orderedNodes = reconstructOrderedNodes(mapping, record.current_node);
  const messages = orderedNodes
    .map((node) => toImportableMessage(node))
    .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

  return {
    title,
    source_conversation_id: sourceConversationId,
    messages,
  };
}
