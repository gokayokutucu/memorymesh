import { getDocuments, saveDocument } from "./document-store";
import { queryByDateRange, queryByTags, queryRelated, saveNode } from "./graph-store";
import { getPointsByIds, savePoint, searchPoints } from "./storage";
import { ISaveMemoryInput, ISearchMemoryInput, ISearchResult } from "./types";

export async function orchestrateSave(
  input: ISaveMemoryInput,
  vector: number[]
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

  const id = await savePoint(vector, payload);

  if (input.memory_type === "output") {
    await saveDocument(id, input.content, {
      project: input.project,
      memory_type: input.memory_type,
      tags: input.tags ?? [],
      title: input.title,
      ref_id: input.ref_id,
      source_type: input.source_type,
    });
  }

  if (input.memory_type !== "preference") {
    await saveNode(
      id,
      input.memory_type,
      input.project,
      input.tags ?? [],
      input.title,
      input.ref_id
    );
  }

  return id;
}

export async function orchestrateSearch(
  vector: number[],
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  const limit = input.limit ?? 5;
  const qdrantResults = await searchPoints(vector, input);
  const qdrantIds = qdrantResults.map((result) => result.id);

  const tagIds = input.tags && input.tags.length > 0
    ? await queryByTags(input.tags, limit)
    : [];
  const dateRangeIds = input.after || input.before
    ? await queryByDateRange(input.after, input.before, input.project, limit)
    : [];
  const relatedIds = await queryRelated(qdrantIds, limit);

  const allIds = [...qdrantIds, ...tagIds, ...dateRangeIds, ...relatedIds];
  const uniqueIds = [...new Set(allIds)];

  const existingResultMap = new Map<string, ISearchResult>();
  for (const result of qdrantResults) {
    existingResultMap.set(result.id, result);
  }

  const missingIds = uniqueIds.filter((id) => !existingResultMap.has(id));
  const fetchedResults = await getPointsByIds(missingIds);
  for (const result of fetchedResults) {
    existingResultMap.set(result.id, result);
  }

  const mergedResults = uniqueIds
    .map((id) => existingResultMap.get(id))
    .filter((result): result is ISearchResult => Boolean(result));

  const sortedResults = sortResults(mergedResults, input.sort_by).slice(0, limit);
  const docs = await getDocuments(sortedResults.map((result) => result.id));

  return sortedResults.map((result) => ({
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
