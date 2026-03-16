import type {
  ISaveMemoryResult,
  MemoryType,
  SourceType,
} from "@memorymesh/core";

export {
  MemoryType,
  SourceType,
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISearchMemoryInput,
  ISearchResult,
  IProjectSummary,
} from "@memorymesh/core";

// Server-internal payload shape stored in backing stores.
export interface IMemoryPayload {
  content: string;
  project: string;
  memory_type: MemoryType;
  created_at: string;
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

export interface ISaveStoreState {
  qdrant_saved: boolean;
  mongo_saved: boolean;
  neo4j_saved: boolean;
}

export interface ISaveMemoryStatus extends ISaveMemoryResult, ISaveStoreState {
  updated_at: string;
  error?: string;
}

export interface ISaveOrchestrationResult extends ISaveStoreState {
  id: string;
}

export interface IGetMemoryByRefInput {
  ref_id: string;
  project?: string;
  limit?: number;
}

export interface IGetRelatedMemoriesInput {
  id: string;
  limit?: number;
}
