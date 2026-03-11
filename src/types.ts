export type MemoryType = "decision" | "learning" | "context" | "preference" | "output";
export type SourceType = "code_block" | "email" | "document" | "plan" | "summary";

export interface IMemoryPayload {
  content: string;
  project: string;
  memory_type: MemoryType;
  created_at: string;
  tags?: string[];
  title?: string;
  ref_id?: string;
  source_type?: SourceType;
}

export interface ISearchResult {
  id: string;
  content: string;
  project: string;
  memory_type: MemoryType;
  similarity_score: number;
  created_at: string;
  tags?: string[];
  full_content?: string;
  title?: string;
  ref_id?: string;
  source_type?: SourceType;
}

export interface ISaveMemoryInput {
  content: string;
  project: string;
  memory_type: MemoryType;
  tags?: string[];
  title?: string;
  ref_id?: string;
  source_type?: SourceType;
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

export interface IProjectSummary {
  project: string;
  memory_count: number;
}
