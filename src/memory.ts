import { embed } from "./embeddings";
import { ensureCollection, listProjects } from "./storage";
import { randomUUID } from "node:crypto";
import {
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISearchMemoryInput,
  ISearchResult,
  IProjectSummary,
} from "./types";
import { orchestrateSave, orchestrateSearch } from "./orchestrator";
import { Profiler } from "./profiler";

export function saveMemory(input: ISaveMemoryInput): ISaveMemoryResult {
  const id = randomUUID();
  const profiler = new Profiler();

  (async () => {
    try {
      await ensureCollection();
      const vector = await profiler.time("embed", async () => embed(input.content));
      await orchestrateSave(input, vector, profiler, id);
      console.error(profiler.summary());
    } catch (error) {
      console.error("[memorymesh] background save failed:", error);
    }
  })();

  return { id, status: "pending" };
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
