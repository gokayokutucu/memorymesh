import { createMemoryService, IMemoryGateway } from "@memorymesh/core";
import { randomUUID } from "node:crypto";
import { getDocuments } from "./document-store";
import { getRelated } from "./graph-store";
import { embed } from "./embeddings";
import { buildPreview, orchestrateSave, orchestrateSearch } from "./orchestrator";
import { Profiler } from "./profiler";
import { ensureCollection, getPointsByIds, listProjects, searchPoints } from "./storage";
import {
  IGetRelatedMemoriesInput,
  IGetMemoryByRefInput,
  IProjectSummary,
  ISaveMemoryInput,
  ISaveMemoryResult,
  ISaveMemoryStatus,
  ISearchMemoryInput,
  ISearchResult,
} from "./types";

const saveStatusRegistry = new Map<string, ISaveMemoryStatus>();

const gateway: IMemoryGateway = {
  save: saveMemoryInternal,
  getStatus: getMemoryStatusInternal,
  search: searchMemoryInternal,
  getById: getMemoryByIdInternal,
  getByRef: getMemoryByRefInternal,
  getRelated: getRelatedMemoriesInternal,
  listProjects: getProjectsInternal,
};

const memoryService = createMemoryService(gateway);

export function saveMemory(input: ISaveMemoryInput): ISaveMemoryResult {
  return memoryService.saveMemory(input);
}

export function getMemoryStatus(id: string): ISaveMemoryStatus | null {
  return memoryService.getMemoryStatus(id) as ISaveMemoryStatus | null;
}

export async function searchMemory(
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  return memoryService.searchMemory(input);
}

export async function getProjects(): Promise<IProjectSummary[]> {
  return memoryService.getProjects();
}

export async function getMemoryById(id: string): Promise<ISearchResult | null> {
  return memoryService.getMemoryById(id);
}

export async function getMemoryByRef(
  input: IGetMemoryByRefInput
): Promise<ISearchResult[]> {
  return memoryService.getMemoryByRef(input);
}

export async function getRelatedMemories(
  input: IGetRelatedMemoriesInput
): Promise<ISearchResult[]> {
  return memoryService.getRelatedMemories(input);
}

function saveMemoryInternal(input: ISaveMemoryInput): ISaveMemoryResult {
  const id = randomUUID();
  const profiler = new Profiler();
  setSaveStatus(id, {
    id,
    status: "pending",
    qdrant_saved: false,
    mongo_saved: false,
    neo4j_saved: false,
  });

  (async () => {
    try {
      await ensureCollection();
      const vector = await profiler.time("embed", async () => embed(input.content));
      const orchestration = await orchestrateSave(input, vector, profiler, id);
      const status = resolveSaveStatus(input, orchestration);
      setSaveStatus(id, {
        id,
        status,
        qdrant_saved: orchestration.qdrant_saved,
        mongo_saved: orchestration.mongo_saved,
        neo4j_saved: orchestration.neo4j_saved,
      });
      console.error(profiler.summary());
    } catch (error) {
      setSaveStatus(id, {
        id,
        status: "failed",
        qdrant_saved: false,
        mongo_saved: false,
        neo4j_saved: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("[memorymesh] background save failed:", error);
    }
  })();

  return { id, status: "pending" };
}

function getMemoryStatusInternal(id: string): ISaveMemoryStatus | null {
  return saveStatusRegistry.get(id) ?? null;
}

async function searchMemoryInternal(
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

async function getProjectsInternal(): Promise<IProjectSummary[]> {
  await ensureCollection();
  return listProjects();
}

async function getMemoryByIdInternal(id: string): Promise<ISearchResult | null> {
  await ensureCollection();
  const profiler = new Profiler();
  try {
    const points = await profiler.time("qdrant_search", async () =>
      getPointsByIds([id]));
    if (points.length === 0) {
      return null;
    }

    const hydrated = await hydrateWithFullContent(points, profiler);
    return hydrated[0] ?? points[0];
  } finally {
    console.error(profiler.summary());
  }
}

async function getMemoryByRefInternal(
  input: IGetMemoryByRefInput
): Promise<ISearchResult[]> {
  await ensureCollection();
  const profiler = new Profiler();
  try {
    const baseResults = await profiler.time("qdrant_search", async () =>
      searchPoints([], {
        query: input.ref_id,
        ref_id: input.ref_id,
        project: input.project,
        limit: input.limit ?? 10,
        sort_by: "recency",
      }));

    return hydrateWithFullContent(baseResults, profiler);
  } finally {
    console.error(profiler.summary());
  }
}

async function getRelatedMemoriesInternal(
  input: IGetRelatedMemoriesInput
): Promise<ISearchResult[]> {
  await ensureCollection();
  const profiler = new Profiler();
  try {
    const relatedIds = await profiler.time("neo4j_query", async () =>
      getRelated(input.id));
    const uniqueIds = [...new Set(relatedIds)]
      .filter((id) => id !== input.id)
      .slice(0, input.limit ?? 10);
    const results = await profiler.time("qdrant_search", async () =>
      getPointsByIds(uniqueIds));
    return results.map((result) => ({
      ...result,
      preview: buildPreview(result.content),
    }));
  } finally {
    console.error(profiler.summary());
  }
}

async function hydrateWithFullContent(
  results: ISearchResult[],
  profiler?: Profiler
): Promise<ISearchResult[]> {
  if (results.length === 0) {
    return results;
  }

  const docs = profiler
    ? await profiler.time("mongo_fetch", async () =>
      getDocuments(results.map((result) => result.id)))
    : await getDocuments(results.map((result) => result.id));

  return results.map((result) => ({
    ...result,
    full_content: docs.get(result.id),
  }));
}

function resolveSaveStatus(
  input: ISaveMemoryInput,
  state: {
    qdrant_saved: boolean;
    mongo_saved: boolean;
    neo4j_saved: boolean;
  }
): ISaveMemoryResult["status"] {
  if (!state.qdrant_saved) {
    return "failed";
  }

  const requiresMongo = input.memory_type === "output";
  const requiresNeo4j = input.memory_type !== "preference";
  const mongoOk = !requiresMongo || state.mongo_saved;
  const neo4jOk = !requiresNeo4j || state.neo4j_saved;

  if (mongoOk && neo4jOk) {
    return "saved";
  }
  return "partial";
}

function setSaveStatus(
  id: string,
  status: Omit<ISaveMemoryStatus, "updated_at">
): void {
  saveStatusRegistry.set(id, {
    ...status,
    updated_at: new Date().toISOString(),
  });
}
