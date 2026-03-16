import {
  IProjectSummary,
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISearchMemoryInput,
  ISearchResult,
} from "../types";
import {
  IGetMemoryByRefInput,
  IGetRelatedMemoriesInput,
  IMemoryGateway,
  ISaveMemoryStatus,
} from "./memory-gateway";

export interface IMemoryService {
  saveMemory(input: ISaveMemoryInput): ISaveMemoryResult;
  getMemoryStatus(id: string): ISaveMemoryStatus | null;
  searchMemory(input: ISearchMemoryInput): Promise<ISearchResult[]>;
  getMemoryById(id: string): Promise<ISearchResult | null>;
  getMemoryByRef(input: IGetMemoryByRefInput): Promise<ISearchResult[]>;
  getRelatedMemories(input: IGetRelatedMemoriesInput): Promise<ISearchResult[]>;
  getProjects(): Promise<IProjectSummary[]>;
}

export function createMemoryService(gateway: IMemoryGateway): IMemoryService {
  return {
    saveMemory(input: ISaveMemoryInput): ISaveMemoryResult {
      return gateway.save({
        ...input,
        project: input.project?.trim() ? input.project : "general",
      });
    },

    getMemoryStatus(id: string): ISaveMemoryStatus | null {
      return gateway.getStatus(id);
    },

    async searchMemory(input: ISearchMemoryInput): Promise<ISearchResult[]> {
      return gateway.search({
        ...input,
        limit: input.limit ?? 5,
      });
    },

    async getMemoryById(id: string): Promise<ISearchResult | null> {
      return gateway.getById(id);
    },

    async getMemoryByRef(input: IGetMemoryByRefInput): Promise<ISearchResult[]> {
      return gateway.getByRef({
        ...input,
        limit: input.limit ?? 10,
      });
    },

    async getRelatedMemories(
      input: IGetRelatedMemoriesInput
    ): Promise<ISearchResult[]> {
      return gateway.getRelated({
        ...input,
        limit: input.limit ?? 10,
      });
    },

    async getProjects(): Promise<IProjectSummary[]> {
      return gateway.listProjects();
    },
  };
}
