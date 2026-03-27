export type JsonFileCategory =
  | "supported_conversation_file"
  | "unsupported_conversation_schema"
  | "ignorable_json"
  | "unknown_json"
  | "invalid_json";

export interface IJsonFileClassification {
  category: JsonFileCategory;
  reason: string;
}

export function classifyJsonFileContent(
  filePath: string,
  content: string
): IJsonFileClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      category: "invalid_json",
      reason: "invalid_json_parse_error",
    };
  }

  return classifyParsedJson(filePath, parsed);
}

export function classifyParsedJson(
  filePath: string,
  parsed: unknown
): IJsonFileClassification {
  void filePath;

  if (isSupportedConversationSchema(parsed)) {
    return {
      category: "supported_conversation_file",
      reason: "array_with_mapping_and_current_node",
    };
  }

  if (isUnsupportedGroupChatSchema(parsed)) {
    return {
      category: "unsupported_conversation_schema",
      reason: "group_chats_schema_not_supported_in_phase",
    };
  }

  if (isIgnorableMetadataShape(parsed)) {
    return {
      category: "ignorable_json",
      reason: "metadata_or_support_json",
    };
  }

  return {
    category: "unknown_json",
    reason: "unknown_json_shape",
  };
}

function isSupportedConversationSchema(parsed: unknown): boolean {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return false;
  }

  return parsed.some((item) => {
    if (!isRecord(item)) {
      return false;
    }

    const hasCurrentNode =
      typeof item.current_node === "string" ||
      typeof item.current_node === "number" ||
      item.current_node === null;

    return hasCurrentNode && isRecord(item.mapping);
  });
}

function isUnsupportedGroupChatSchema(parsed: unknown): boolean {
  if (!isRecord(parsed) || !Array.isArray(parsed.chats)) {
    return false;
  }

  return parsed.chats.some((chat) => {
    if (!isRecord(chat)) {
      return false;
    }

    return Array.isArray(chat.messages);
  });
}

function isIgnorableMetadataShape(parsed: unknown): boolean {
  if (isRecord(parsed)) {
    const keySet = new Set(Object.keys(parsed));
    const knownObjectPatterns = [
      "manifest",
      "exported_at",
      "user_profile",
      "settings",
      "feedback",
      "shared_conversations",
    ];

    if (knownObjectPatterns.some((key) => keySet.has(key))) {
      return true;
    }

    // export_manifest.json style
    if (
      keySet.has("export_files") &&
      keySet.has("logical_files") &&
      keySet.has("manifest_file")
    ) {
      return true;
    }

    // user.json style profile metadata
    if (keySet.has("id") && keySet.has("email")) {
      return true;
    }
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0];
    if (!isRecord(first)) {
      return false;
    }

    const keySet = new Set(Object.keys(first));

    // shared_conversations.json style index rows
    if (
      keySet.has("conversation_id") &&
      keySet.has("title") &&
      keySet.has("is_anonymous")
    ) {
      return true;
    }

    // message_feedback.json style rows
    if (
      keySet.has("evaluation_name") &&
      keySet.has("rating") &&
      keySet.has("conversation_id")
    ) {
      return true;
    }

    // user_settings.json style rows
    if (keySet.has("user_id") && keySet.has("settings")) {
      return true;
    }
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
