export type MemoryType = "decision" | "learning" | "context" | "preference" | "output";

export interface IMemoryPayload {
  content: string;
  project: string;
  memory_type: MemoryType;
  created_at: string;
  tags?: string[];
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
}

export interface ISaveMemoryInput {
  content: string;
  project: string;
  memory_type: MemoryType;
  tags?: string[];
}

export interface ISearchMemoryInput {
  query: string;
  project?: string;
  limit?: number;
  tags?: string[];
}

export interface IProjectSummary {
  project: string;
  memory_count: number;
}
