import { QdrantClient } from "@qdrant/js-client-rest";
import { IMemoryPayload, ISearchResult } from "./types";
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
  payload: IMemoryPayload
): Promise<string> {
  const id = randomUUID();
  await client.upsert(COLLECTION, {
    wait: true,
    points: [{ id, vector, payload: payload as unknown as Record<string, unknown> }],
  });
  return id;
}

export async function searchPoints(
  vector: number[],
  project: string | undefined,
  limit: number,
  tags?: string[],
  refId?: string,
  title?: string,
  sourceType?: string
): Promise<ISearchResult[]> {
  const must: Array<Record<string, unknown>> = [];
  if (project) {
    must.push({ key: "project", match: { value: project } });
  }
  if (tags && tags.length > 0) {
    must.push({ key: "tags", match: { any: tags } });
  }
  if (refId) {
    must.push({ key: "ref_id", match: { value: refId } });
  }
  if (title) {
    must.push({ key: "title", match: { value: title } });
  }
  if (sourceType) {
    must.push({ key: "source_type", match: { value: sourceType } });
  }
  const filter = must.length > 0 ? { must } : undefined;

  if (refId) {
    const exactResults = await client.scroll(COLLECTION, {
      limit,
      filter,
      with_payload: true,
      with_vector: false,
    });

    return exactResults.points.map((point) => {
      const p = point.payload as unknown as IMemoryPayload;
      return {
        id: String(point.id),
        content: p.content,
        project: p.project,
        memory_type: p.memory_type,
        similarity_score: 1,
        created_at: p.created_at,
        tags: p.tags,
        title: p.title,
        ref_id: p.ref_id,
        source_type: p.source_type,
      };
    });
  }

  const results = await client.search(COLLECTION, {
    vector,
    limit,
    filter,
    with_payload: true,
  });

  return results.map((r) => {
    const p = r.payload as unknown as IMemoryPayload;
    return {
      id: String(r.id),
      content: p.content,
      project: p.project,
      memory_type: p.memory_type,
      similarity_score: r.score,
      created_at: p.created_at,
      tags: p.tags,
      title: p.title,
      ref_id: p.ref_id,
      source_type: p.source_type,
    };
  });
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
