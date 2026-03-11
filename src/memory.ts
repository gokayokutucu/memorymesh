import { embed } from "./embeddings";
import { ensureCollection, listProjects } from "./storage";
import {
  ISaveMemoryInput,
  ISearchMemoryInput,
  ISearchResult,
  IProjectSummary,
} from "./types";
import { orchestrateSave, orchestrateSearch } from "./orchestrator";
import { Profiler } from "./profiler";

export async function saveMemory(input: ISaveMemoryInput): Promise<string> {
  await ensureCollection();
  const profiler = new Profiler();
  try {
    const vector = await profiler.time("embed", async () => embed(input.content));
    return await orchestrateSave(input, vector, profiler);
  } finally {
    console.error(profiler.summary());
  }
}

export async function searchMemory(
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  await ensureCollection();
  const profiler = new Profiler();
  try {
    if (input.ref_id) {
      return await orchestrateSearch([], input, profiler);
    }
    const vector = await profiler.time("embed", async () => embed(input.query));
    return await orchestrateSearch(vector, input, profiler);
  } finally {
    console.error(profiler.summary());
  }
}

export async function getProjects(): Promise<IProjectSummary[]> {
  await ensureCollection();
  return listProjects();
}
