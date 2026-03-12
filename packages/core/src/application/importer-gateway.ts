import { ISaveMemoryInput } from "../types";
import { ISearchResult } from "../types";

export interface IImporterGateway {
  saveMemory(input: ISaveMemoryInput): Promise<void>;
  getMemoryByRef(refId: string, project?: string): Promise<ISearchResult[]>;
  saveBatch?(inputs: ISaveMemoryInput[]): Promise<void>;
}
