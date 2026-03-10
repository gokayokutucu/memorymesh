import { embed } from "./embeddings";
import {
  ensureCollection,
  savePoint,
  searchPoints,
  listProjects,
} from "./storage";
import {
  ISaveMemoryInput,
  ISearchMemoryInput,
  ISearchResult,
  IMemoryPayload,
  IProjectSummary,
} from "./types";

export async function saveMemory(input: ISaveMemoryInput): Promise<string> {
  await ensureCollection();
  const vector = await embed(input.content);
  const payload: IMemoryPayload = {
    content: input.content,
    project: input.project,
    memory_type: input.memory_type,
    created_at: new Date().toISOString(),
  };
  const id = await savePoint(vector, payload);
  return id;
}

export async function searchMemory(
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  await ensureCollection();
  const vector = await embed(input.query);
  return searchPoints(vector, input.project, input.limit ?? 5);
}

export async function getProjects(): Promise<IProjectSummary[]> {
  await ensureCollection();
  return listProjects();
}
