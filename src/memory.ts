import { embed } from "./embeddings";
import { ensureCollection, listProjects } from "./storage";
import {
  ISaveMemoryInput,
  ISearchMemoryInput,
  ISearchResult,
  IProjectSummary,
} from "./types";
import { orchestrateSave, orchestrateSearch } from "./orchestrator";

export async function saveMemory(input: ISaveMemoryInput): Promise<string> {
  await ensureCollection();
  const vector = await embed(input.content);
  return orchestrateSave(input, vector);
}

export async function searchMemory(
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  await ensureCollection();
  if (input.ref_id) {
    return orchestrateSearch([], input);
  }
  const vector = await embed(input.query);
  return orchestrateSearch(vector, input);
}

export async function getProjects(): Promise<IProjectSummary[]> {
  await ensureCollection();
  return listProjects();
}
