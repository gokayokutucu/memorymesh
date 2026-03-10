import { getDocuments, saveDocument } from "./document-store";
import { saveNode } from "./graph-store";
import { savePoint, searchPoints } from "./storage";
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
  };

  const id = await savePoint(vector, payload);

  if (input.memory_type === "output") {
    await saveDocument(id, input.content, {
      project: input.project,
      memory_type: input.memory_type,
      tags: input.tags ?? [],
    });
  }

  if (input.memory_type !== "preference") {
    await saveNode(id, input.memory_type, input.project, input.tags ?? []);
  }

  return id;
}

export async function orchestrateSearch(
  vector: number[],
  input: ISearchMemoryInput
): Promise<ISearchResult[]> {
  const qdrantResults = await searchPoints(
    vector,
    input.project,
    input.limit ?? 5,
    input.tags
  );

  const ids = qdrantResults.map((result) => result.id);
  const docs = await getDocuments(ids);

  return qdrantResults.map((result) => ({
    ...result,
    full_content: docs.get(result.id),
  }));
}
