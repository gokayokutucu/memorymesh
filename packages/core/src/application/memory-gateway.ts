import {
  IProjectSummary,
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISearchMemoryInput,
  ISearchResult,
} from "../types";

export interface ISaveStoreState {
  qdrant_saved: boolean;
  mongo_saved: boolean;
  neo4j_saved: boolean;
}

export interface ISaveMemoryStatus extends ISaveMemoryResult, ISaveStoreState {
  updated_at: string;
  error?: string;
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

export interface IMemoryGateway {
  save(input: ISaveMemoryInput): ISaveMemoryResult;
  getStatus(id: string): ISaveMemoryStatus | null;
  search(input: ISearchMemoryInput): Promise<ISearchResult[]>;
  getById(id: string): Promise<ISearchResult | null>;
  getByRef(input: IGetMemoryByRefInput): Promise<ISearchResult[]>;
  getRelated(input: IGetRelatedMemoriesInput): Promise<ISearchResult[]>;
  listProjects(): Promise<IProjectSummary[]>;
}
