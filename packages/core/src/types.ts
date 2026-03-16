export type MemoryType =
  | "decision"
  | "learning"
  | "context"
  | "preference"
  | "output";

export type SourceType =
  | "code_block"
  | "email"
  | "document"
  | "plan"
  | "summary"
  | "imported_conversation";

export interface ISaveMemoryInput {
  content: string;
  project: string;
  memory_type: MemoryType;
  created_at?: string;
  importance?: number;
  conversation_id?: string;
  parent_memory_id?: string;
  derived_from_memory_id?: string;
  source_agent?: string;
  source_format?: string;
  message_index?: number;
  tags?: string[];
  title?: string;
  ref_id?: string;
  source_type?: SourceType;
}

export interface ISaveMemoryResult {
  id: string;
  status: "pending" | "saved" | "partial" | "failed" | "skipped";
  error_code?:
    | "payload_too_large"
    | "embedding_input_too_large"
    | "memory_write_disabled"
    | "qdrant_transient_failure"
    | "mongo_transient_failure"
    | "neo4j_transient_failure";
  error_message?: string;
  reason?: "memory_write_disabled";
  payload_bytes?: number;
  max_payload_bytes?: number;
}

export interface ISearchMemoryInput {
  query: string;
  project?: string;
  limit?: number;
  tags?: string[];
  ref_id?: string;
  title?: string;
  source_type?: string;
  sort_by?: "relevance" | "recency" | "oldest";
  before?: string;
  after?: string;
}

export interface ISearchResult {
  id: string;
  content: string;
  preview?: string;
  project: string;
  semantic_score: number;
  memory_type: MemoryType;
  similarity_score: number;
  hybrid_score?: number;
  created_at: string;
  importance?: number;
  conversation_id?: string;
  parent_memory_id?: string;
  derived_from_memory_id?: string;
  source_agent?: string;
  source_format?: string;
  message_index?: number;
  tags?: string[];
  full_content?: string;
  title?: string;
  ref_id?: string;
  source_type?: SourceType;
}

export interface IProjectSummary {
  project: string;
  memory_count: number;
}
