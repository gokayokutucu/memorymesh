import { QdrantClient } from "@qdrant/js-client-rest";
import { IMemoryPayload, ISearchMemoryInput, ISearchResult } from "./types";
import { randomUUID } from "crypto";

const QDRANT_HOST = process.env.QDRANT_HOST ?? "localhost";
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT ?? "6333");
const COLLECTION = process.env.QDRANT_COLLECTION ?? "memories";
const VECTOR_SIZE = 768; // nomic-embed-text dimension

const client = new QdrantClient({ host: QDRANT_HOST, port: QDRANT_PORT });

export async function ensureCollection(): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await client.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
}

export async function savePoint(
  vector: number[],
  payload: IMemoryPayload,
  id?: string
): Promise<string> {
  const pointId = id ?? randomUUID();
  await client.upsert(COLLECTION, {
    wait: true,
    points: [{ id: pointId, vector, payload: payload as unknown as Record<string, unknown> }],
  });
  return pointId;
}

export async function searchPoints(
  vector: number[],
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  const must: Array<Record<string, unknown>> = [];
  if (input.project) {
    must.push({ key: "project", match: { value: input.project } });
  }
  if (input.tags && input.tags.length > 0) {
    must.push({ key: "tags", match: { any: input.tags } });
  }
  if (input.ref_id) {
    must.push({ key: "ref_id", match: { value: input.ref_id } });
  }
  if (input.title) {
    must.push({ key: "title", match: { value: input.title } });
  }
  if (input.source_type) {
    must.push({ key: "source_type", match: { value: input.source_type } });
  }
  if (input.before) {
    must.push({ key: "created_at", range: { lt: input.before } });
  }
  if (input.after) {
    must.push({ key: "created_at", range: { gt: input.after } });
  }
  const filter = must.length > 0 ? { must } : undefined;
  const limit = input.limit ?? 5;

  if (input.ref_id) {
    const exactResults = await client.scroll(COLLECTION, {
      limit,
      filter,
      with_payload: true,
      with_vector: false,
    });

    const mappedResults = exactResults.points.map((point) => {
      const p = point.payload as unknown as IMemoryPayload;
      return {
        id: String(point.id),
        content: p.content,
        project: p.project,
        memory_type: p.memory_type,
        semantic_score: 1,
        similarity_score: 1,
        created_at: p.created_at,
        importance: p.importance,
        conversation_id: p.conversation_id,
        parent_memory_id: p.parent_memory_id,
        derived_from_memory_id: p.derived_from_memory_id,
        source_agent: p.source_agent,
        source_format: p.source_format,
        message_index: p.message_index,
        tags: p.tags,
        title: p.title,
        ref_id: p.ref_id,
        source_type: p.source_type,
      };
    });

    return sortResults(mappedResults, input.sort_by);
  }

  const results = await client.search(COLLECTION, {
    vector,
    limit,
    filter,
    with_payload: true,
  });

  const mappedResults = results.map((r) => {
    const p = r.payload as unknown as IMemoryPayload;
    return {
      id: String(r.id),
      content: p.content,
      project: p.project,
      memory_type: p.memory_type,
      semantic_score: r.score,
      similarity_score: r.score,
      created_at: p.created_at,
      importance: p.importance,
      conversation_id: p.conversation_id,
      parent_memory_id: p.parent_memory_id,
      derived_from_memory_id: p.derived_from_memory_id,
      source_agent: p.source_agent,
      source_format: p.source_format,
      message_index: p.message_index,
      tags: p.tags,
      title: p.title,
      ref_id: p.ref_id,
      source_type: p.source_type,
    };
  });

  return sortResults(mappedResults, input.sort_by);
}

function sortResults(
  results: ISearchResult[],
  sortBy: ISearchMemoryInput["sort_by"]
): ISearchResult[] {
  if (sortBy === "recency") {
    return [...results].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }
  if (sortBy === "oldest") {
    return [...results].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    );
  }
  return results;
}

export async function listProjects(): Promise<
  { project: string; memory_count: number }[]
> {
  const result = await client.scroll(COLLECTION, {
    limit: 1000,
    with_payload: true,
  });

  const counts: Record<string, number> = {};
  for (const point of result.points) {
    const p = point.payload as unknown as IMemoryPayload;
    counts[p.project] = (counts[p.project] ?? 0) + 1;
  }

  return Object.entries(counts).map(([project, memory_count]) => ({
    project,
    memory_count,
  }));
}

export async function getPointsByIds(ids: string[]): Promise<ISearchResult[]> {
  if (ids.length === 0) {
    return [];
  }

  const points = await client.retrieve(COLLECTION, {
    ids,
    with_payload: true,
    with_vector: false,
  });

  return points.map((point) => {
    const payload = point.payload as unknown as IMemoryPayload;
    return {
      id: String(point.id),
      content: payload.content,
      project: payload.project,
      memory_type: payload.memory_type,
      semantic_score: 0,
      similarity_score: 0,
      created_at: payload.created_at,
      importance: payload.importance,
      conversation_id: payload.conversation_id,
      parent_memory_id: payload.parent_memory_id,
      derived_from_memory_id: payload.derived_from_memory_id,
      source_agent: payload.source_agent,
      source_format: payload.source_format,
      message_index: payload.message_index,
      tags: payload.tags,
      title: payload.title,
      ref_id: payload.ref_id,
      source_type: payload.source_type,
    };
  });
}
