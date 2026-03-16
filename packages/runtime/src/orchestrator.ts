import { getDocuments, saveDocument } from "./document-store";
import { queryByDateRange, queryByTags, queryRelated, saveNode } from "./graph-store";
import { getPointsByIds, savePoint, searchPoints } from "./storage";
import { randomUUID } from "node:crypto";
import { Profiler } from "./profiler";
import { getRetrievalConfig } from "./config";
import {
  ISaveMemoryInput,
  ISaveOrchestrationResult,
  ISearchMemoryInput,
  ISearchResult,
} from "./types";

export async function orchestrateSave(
  input: ISaveMemoryInput,
  vector: number[],
  profiler?: Profiler,
  preGeneratedId?: string
): Promise<ISaveOrchestrationResult> {
  const id = preGeneratedId ?? randomUUID();
  const createdAt = input.created_at ?? new Date().toISOString();
  const result: ISaveOrchestrationResult = {
    id,
    qdrant_saved: false,
    mongo_saved: false,
    neo4j_saved: false,
  };
  const payload = {
    content: input.content,
    project: input.project,
    memory_type: input.memory_type,
    created_at: createdAt,
    importance: input.importance,
    conversation_id: input.conversation_id,
    parent_memory_id: input.parent_memory_id,
    derived_from_memory_id: input.derived_from_memory_id,
    source_agent: input.source_agent,
    source_format: input.source_format,
    message_index: input.message_index,
    tags: input.tags,
    title: input.title,
    ref_id: input.ref_id,
    source_type: input.source_type,
  };

  const saveQdrant = async (): Promise<string> => savePoint(vector, payload, id);
  try {
    result.id = profiler
      ? await profiler.time("qdrant_save", saveQdrant)
      : await saveQdrant();
    result.qdrant_saved = true;
  } catch (error) {
    console.error("[memorymesh] qdrant save failed:", error);
    return result;
  }

  if (input.memory_type === "output") {
    const saveMongo = async (): Promise<boolean> =>
      saveDocument(result.id, input.content, {
      project: input.project,
      memory_type: input.memory_type,
      importance: input.importance,
      created_at: createdAt,
      conversation_id: input.conversation_id,
      parent_memory_id: input.parent_memory_id,
      derived_from_memory_id: input.derived_from_memory_id,
      source_agent: input.source_agent,
      source_format: input.source_format,
      message_index: input.message_index,
      tags: input.tags ?? [],
      title: input.title,
      ref_id: input.ref_id,
      source_type: input.source_type,
      });
    result.mongo_saved = profiler
      ? await profiler.time("mongo_save", saveMongo)
      : await saveMongo();
  }

  if (input.memory_type !== "preference") {
    const saveGraph = async (): Promise<boolean> =>
      saveNode(
        result.id,
        input.memory_type,
        input.project,
        createdAt,
        input.tags ?? [],
        input.title,
        input.ref_id,
        input.importance,
        input.conversation_id,
        input.parent_memory_id,
        input.derived_from_memory_id,
        input.source_agent,
        input.source_format,
        input.message_index
      );
    result.neo4j_saved = profiler
      ? await profiler.time("neo4j_save", saveGraph)
      : await saveGraph();
  }

  return result;
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

  const graphExpandedIds = new Set<string>([
    ...tagIds,
    ...dateRangeIds,
    ...relatedIds,
  ]);
  const sortedResults = profiler
    ? await profiler.time(
      "recency_sort",
      async () => sortResults(mergedResults, input, graphExpandedIds)
    )
    : sortResults(mergedResults, input, graphExpandedIds);
  const limitedResults = sortedResults.slice(0, limit);
  return applySearchOutputMode(limitedResults, profiler);
}

// Keep hydration available for explicit full-content retrieval flows.
export async function hydrateSearchResultsWithFullContent(
  results: ISearchResult[],
  profiler?: Profiler
): Promise<ISearchResult[]> {
  const docs = profiler
    ? await profiler.time("mongo_fetch", async () =>
      getDocuments(results.map((result) => result.id)))
    : await getDocuments(results.map((result) => result.id));

  return results.map((result) => ({
    ...result,
    full_content: docs.get(result.id),
  }));
}

export function buildPreview(
  content: string,
  maxLength = getRetrievalConfig().previewMaxChars,
  maxLines = getRetrievalConfig().previewMaxLines
): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return "";
  }

  const lines = normalized.split("\n");
  const selectedLines: string[] = [];
  let usedLength = 0;
  for (const line of lines) {
    if (selectedLines.length >= maxLines) {
      break;
    }
    const separatorLength = selectedLines.length > 0 ? 1 : 0;
    const remaining = maxLength - usedLength - separatorLength;
    if (remaining <= 0) {
      break;
    }
    const clipped = line.length <= remaining
      ? line
      : truncateAtBoundary(line, remaining);
    selectedLines.push(clipped);
    usedLength += separatorLength + clipped.length;
    if (clipped.length < line.length) {
      break;
    }
  }

  const preview = selectedLines.join("\n").trimEnd();
  const wasTruncated =
    preview.length < normalized.length || selectedLines.length < lines.length;
  return wasTruncated ? `${preview}\n...[truncated]` : preview;
}

async function applySearchOutputMode(
  results: ISearchResult[],
  profiler?: Profiler
): Promise<ISearchResult[]> {
  const config = getRetrievalConfig();
  if (results.length === 0) {
    return results;
  }

  if (config.mode === "preview") {
    return results.map((result) => ({
      ...result,
      preview: buildPreview(result.content, config.previewMaxChars, config.previewMaxLines),
    }));
  }

  // Search output is injected into LLM context. These modes let users trade
  // token efficiency vs convenience at runtime.
  const ids = results.map((result) => result.id);
  const docs = profiler
    ? await profiler.time("mongo_fetch", async () => getDocuments(ids))
    : await getDocuments(ids);

  return results.map((result) => {
    const fullText = docs.get(result.id) ?? result.content;
    if (config.mode === "full") {
      return { ...result, content: fullText, preview: undefined };
    }

    const useFull = fullText.length <= config.adaptiveThreshold;
    return {
      ...result,
      content: useFull ? fullText : result.content,
      preview: useFull
        ? undefined
        : buildPreview(fullText, config.previewMaxChars, config.previewMaxLines),
    };
  });
}

function truncateAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 8) {
    return text.slice(0, maxLength);
  }

  const slice = text.slice(0, maxLength);
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const char = slice[i];
    if (/\s|[,.;:)\]}]/.test(char)) {
      if (i >= Math.floor(maxLength * 0.6)) {
        return slice.slice(0, i).trimEnd();
      }
      break;
    }
  }

  return slice.trimEnd();
}

function sortResults(
  results: ISearchResult[],
  input: ISearchMemoryInput,
  graphExpandedIds: Set<string>
): ISearchResult[] {
  const sortBy = input.sort_by;
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

  const timestampRange = getTimestampRange(results);
  const scored = results.map((result) => ({
    ...result,
    hybrid_score: computeHybridScore(result, input, graphExpandedIds, timestampRange),
  }));
  return scored.sort((a, b) => (b.hybrid_score ?? 0) - (a.hybrid_score ?? 0));
}

interface ITimestampRange {
  min: number;
  max: number;
}

function getTimestampRange(results: ISearchResult[]): ITimestampRange {
  if (results.length === 0) {
    return { min: 0, max: 0 };
  }
  const timestamps = results.map((result) => safeTimestamp(result.created_at));
  return {
    min: Math.min(...timestamps),
    max: Math.max(...timestamps),
  };
}

function safeTimestamp(value: string): number {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

function computeRecencyBoost(
  createdAt: string,
  range: ITimestampRange
): number {
  if (range.max <= range.min) {
    return 0.1;
  }
  const ts = safeTimestamp(createdAt);
  const normalized = (ts - range.min) / (range.max - range.min);
  return clamp(normalized, 0, 1) * 0.12;
}

function computeHybridScore(
  result: ISearchResult,
  input: ISearchMemoryInput,
  graphExpandedIds: Set<string>,
  timestampRange: ITimestampRange
): number {
  const semanticScore = clamp(result.semantic_score, 0, 1) * 0.75;
  const recencyBoost = computeRecencyBoost(result.created_at, timestampRange);
  const projectBoost =
    input.project && result.project === input.project ? 0.06 : 0;
  const tagBoost =
    input.tags && input.tags.length > 0
      ? computeTagOverlapBoost(input.tags, result.tags)
      : 0;
  const graphBoost = graphExpandedIds.has(result.id) ? 0.07 : 0;

  return semanticScore + recencyBoost + projectBoost + tagBoost + graphBoost;
}

function computeTagOverlapBoost(
  filterTags: string[],
  resultTags: string[] | undefined
): number {
  if (!resultTags || resultTags.length === 0) {
    return 0;
  }
  const filterSet = new Set(filterTags.map((tag) => tag.toLowerCase()));
  const overlapCount = resultTags.reduce((count, tag) => (
    filterSet.has(tag.toLowerCase()) ? count + 1 : count
  ), 0);
  if (overlapCount === 0) {
    return 0;
  }
  const overlapRatio = overlapCount / Math.max(filterSet.size, 1);
  return clamp(overlapRatio, 0, 1) * 0.08;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
