import { ISaveMemoryInput } from "../../types";

export interface IRawConversation {
  id?: unknown;
  conversation_id?: unknown;
  title?: unknown;
  current_node?: unknown;
  mapping?: unknown;
}

export interface IRawMappingNode {
  id: string;
  parent?: string | null;
  children: string[];
  message?: {
    author?: { role?: unknown };
    content?: { content_type?: unknown; parts?: unknown };
    create_time?: unknown;
  };
}

export interface IGptMessage {
  id?: string;
  role: string;
  content: string;
  content_type?: string;
  create_time?: number;
}

export interface IGptConversation {
  title: string;
  source_conversation_id?: string;
  message_offset?: number;
  messages: IGptMessage[];
}

export interface IImportClassifyContext {
  message_index?: number;
  source_conversation_id?: string;
}

export interface IImportResult {
  total_conversations: number;
  saved: number;
  skipped: number;
  skipped_reasons: Record<string, number>;
}

export type IImportPolicy =
  | "skip_existing"
  | "overwrite_existing"
  | "import_anyway";

export interface IImportRunOptions {
  import_policy?: IImportPolicy;
  conversation_delay_ms?: number;
  callbacks?: IImportCallbacks;
}

export interface IImportEvaluation {
  importable: boolean;
  skip_reason?: string;
  payload?: ISaveMemoryInput;
}

export interface IImportCallbacks {
  onMessageStart?: (context: {
    conversation_title: string;
    role: string;
    message_index: number;
    total_messages: number;
    preview: string;
    ref_id?: string;
  }) => void;
  onMessageStageChange?: (context: {
    conversation_title: string;
    role: string;
    message_index: number;
    total_messages: number;
    stage: "dedup" | "save" | "embedding" | "checkpoint" | "skipped" | "completed";
    stage_detail?: string;
    ref_id?: string;
  }) => void;
  onConversationStart?: (context: {
    conversation_index: number;
    total_conversations: number;
    title: string;
    message_count: number;
  }) => void;
  onMessageImported?: (context: {
    conversation_title: string;
    role: string;
    message_index: number;
    memory_type: string;
    ref_id?: string;
    preview: string;
  }) => void;
  onMessageSkipped?: (context: {
    conversation_title: string;
    role: string;
    message_index: number;
    reason: string;
    preview: string;
    ref_id?: string;
    payload_bytes?: number;
  }) => void;
  onConversationComplete?: (context: {
    conversation_index: number;
    total_conversations: number;
    title: string;
    saved: number;
    skipped: number;
  }) => void;
}
