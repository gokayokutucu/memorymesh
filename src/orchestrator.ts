import { getDocuments, saveDocument } from "./document-store";
import { queryByDateRange, queryByTags, queryRelated, saveNode } from "./graph-store";
import { getPointsByIds, savePoint, searchPoints } from "./storage";
import { Profiler } from "./profiler";
import { ISaveMemoryInput, ISearchMemoryInput, ISearchResult } from "./types";

export async function orchestrateSave(
  input: ISaveMemoryInput,
  vector: number[],
  profiler?: Profiler
): Promise<string> {
  const payload = {
    content: input.content,
    project: input.project,
    memory_type: input.memory_type,
    created_at: new Date().toISOString(),
    tags: input.tags,
    title: input.title,
    ref_id: input.ref_id,
    source_type: input.source_type,
  };

  const saveQdrant = async (): Promise<string> => savePoint(vector, payload);
  const id = profiler
    ? await profiler.time("qdrant_save", saveQdrant)
    : await saveQdrant();

  if (input.memory_type === "output") {
    const saveMongo = async (): Promise<void> =>
      saveDocument(id, input.content, {
      project: input.project,
      memory_type: input.memory_type,
      tags: input.tags ?? [],
      title: input.title,
      ref_id: input.ref_id,
      source_type: input.source_type,
      });
    if (profiler) {
      await profiler.time("mongo_save", saveMongo);
    } else {
      await saveMongo();
    }
  }

  if (input.memory_type !== "preference") {
    const saveGraph = async (): Promise<void> =>
      saveNode(
        id,
        input.memory_type,
        input.project,
        input.tags ?? [],
        input.title,
        input.ref_id
      );
    if (profiler) {
      await profiler.time("neo4j_save", saveGraph);
    } else {
      await saveGraph();
    }
  }

  return id;
}

export async function orchestrateSearch(
  vector: number[],
  input: ISearchMemoryInput,
  profiler?: Profiler
): Promise<ISearchResult[]> {
  const limit = input.limit ?? 5;
  const qdrantResults = profiler
    ? await profiler.time("qdrant_search", async () => searchPoints(vector, input))
    : await searchPoints(vector, input);
  const qdrantIds = qdrantResults.map((result) => result.id);

  const runGraphQueries = async (): Promise<{
    tagIds: string[];
    dateRangeIds: string[];
    relatedIds: string[];
  }> => {
    const tagIds = input.tags && input.tags.length > 0
      ? await queryByTags(input.tags, limit)
      : [];
    const dateRangeIds = input.after || input.before
      ? await queryByDateRange(input.after, input.before, input.project, limit)
      : [];
    const relatedIds = await queryRelated(qdrantIds, limit);
    return { tagIds, dateRangeIds, relatedIds };
  };
  const graphQueryResult = profiler
    ? await profiler.time("neo4j_query", runGraphQueries)
    : await runGraphQueries();
  const { tagIds, dateRangeIds, relatedIds } = graphQueryResult;

  const allIds = [...qdrantIds, ...tagIds, ...dateRangeIds, ...relatedIds];
  const uniqueIds = [...new Set(allIds)];

  const existingResultMap = new Map<string, ISearchResult>();
  for (const result of qdrantResults) {
    existingResultMap.set(result.id, result);
  }

  const missingIds = uniqueIds.filter((id) => !existingResultMap.has(id));
  const fetchedResults = profiler
    ? await profiler.time("qdrant_search", async () => getPointsByIds(missingIds))
    : await getPointsByIds(missingIds);
  for (const result of fetchedResults) {
    existingResultMap.set(result.id, result);
  }

  const mergedResults = uniqueIds
    .map((id) => existingResultMap.get(id))
    .filter((result): result is ISearchResult => Boolean(result));

  const sortedResults = profiler
    ? await profiler.time("recency_sort", async () => sortResults(mergedResults, input.sort_by))
    : sortResults(mergedResults, input.sort_by);
  const limitedResults = sortedResults.slice(0, limit);
  const docs = profiler
    ? await profiler.time("mongo_fetch", async () => getDocuments(limitedResults.map((result) => result.id)))
    : await getDocuments(limitedResults.map((result) => result.id));

  return limitedResults.map((result) => ({
    ...result,
    full_content: docs.get(result.id),
  }));
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
