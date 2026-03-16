import { createMemoryService, IMemoryGateway } from "@memorymesh/core";
import { randomUUID } from "node:crypto";
import {
  getMemoryPermissionConfig,
  getProfilerConfig,
  getSavePayloadConfig,
} from "./config";
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
const permissionLogState = {
  readDisabledLogged: false,
  writeDisabledLogged: false,
};

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

export function saveMemoryForImport(input: ISaveMemoryInput): ISaveMemoryResult {
  return saveMemoryInternal(input, { bypassWritePermission: true });
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

function saveMemoryInternal(
  input: ISaveMemoryInput,
  options?: { bypassWritePermission?: boolean }
): ISaveMemoryResult {
  const id = randomUUID();
  if (
    !options?.bypassWritePermission &&
    !getMemoryPermissionConfig().writeEnabled
  ) {
    logWriteDisabledOnce();
    setSaveStatus(id, {
      id,
      status: "skipped",
      reason: "memory_write_disabled",
      qdrant_saved: false,
      mongo_saved: false,
      neo4j_saved: false,
      error: "memory_write_disabled",
      error_code: "memory_write_disabled",
      error_message: "memory_write_disabled",
    });
    return {
      id,
      status: "skipped",
      reason: "memory_write_disabled",
      error_code: "memory_write_disabled",
      error_message: "memory_write_disabled",
    };
  }

  const payloadBytes = Buffer.byteLength(input.content, "utf8");
  const maxPayloadBytes = getSavePayloadConfig().maxPayloadBytes;
  if (payloadBytes > maxPayloadBytes) {
    const status: ISaveMemoryStatus = {
      id,
      status: "failed",
      qdrant_saved: false,
      mongo_saved: false,
      neo4j_saved: false,
      error_code: "payload_too_large",
      error_message: "payload_too_large",
      payload_bytes: payloadBytes,
      max_payload_bytes: maxPayloadBytes,
      error: `payload_too_large:${payloadBytes}>${maxPayloadBytes}`,
      updated_at: new Date().toISOString(),
    };
    saveStatusRegistry.set(id, status);
    return {
      id,
      status: "failed",
      error_code: "payload_too_large",
      error_message: "payload_too_large",
      payload_bytes: payloadBytes,
      max_payload_bytes: maxPayloadBytes,
    };
  }

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
      logProfilerSummary(profiler);
    } catch (error) {
      const errorCode = getKnownErrorCode(error);
      setSaveStatus(id, {
        id,
        status: "failed",
        error_code: errorCode,
        error_message: errorCode ?? undefined,
        qdrant_saved: false,
        mongo_saved: false,
        neo4j_saved: false,
        payload_bytes: payloadBytes,
        max_payload_bytes: maxPayloadBytes,
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
  if (!getMemoryPermissionConfig().readEnabled) {
    logReadDisabledOnce();
    return [];
  }

  await ensureCollection();
  const profiler = new Profiler();
  try {
    if (input.ref_id) {
      return await orchestrateSearch([], input, profiler);
    }
    const vector = await profiler.time("embed", async () => embed(input.query));
    return await orchestrateSearch(vector, input, profiler);
  } finally {
    logProfilerSummary(profiler);
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
    logProfilerSummary(profiler);
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
    logProfilerSummary(profiler);
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
    logProfilerSummary(profiler);
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

function logProfilerSummary(profiler: Profiler): void {
  if (!getProfilerConfig().enabled) {
    return;
  }
  console.error(profiler.summary());
}

function getKnownErrorCode(
  error: unknown
): ISaveMemoryResult["error_code"] | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (
      code === "embedding_input_too_large" ||
      code === "qdrant_transient_failure" ||
      code === "mongo_transient_failure" ||
      code === "neo4j_transient_failure"
    ) {
      return code;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "embedding_input_too_large"
  ) {
    return "embedding_input_too_large";
  }
  return undefined;
}

function logWriteDisabledOnce(): void {
  if (permissionLogState.writeDisabledLogged) {
    return;
  }
  permissionLogState.writeDisabledLogged = true;
  console.error("[memorymesh] memory write disabled");
}

function logReadDisabledOnce(): void {
  if (permissionLogState.readDisabledLogged) {
    return;
  }
  permissionLogState.readDisabledLogged = true;
  console.error("[memorymesh] memory read disabled");
}
