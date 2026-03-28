import { ICommandRunner } from "../system/command-runner";
import { detectQdrantCollectionDimension } from "./qdrant-dimension";

export interface IQdrantCollectionEnsureResult {
  ok: boolean;
  message: string;
  action: "unchanged" | "created" | "recreated";
}

export async function ensureQdrantCollectionDimension(
  runner: ICommandRunner,
  input: {
    collectionName: string;
    embeddingDimension: number;
  }
): Promise<IQdrantCollectionEnsureResult> {
  const existingDimension = await detectQdrantCollectionDimension(
    runner,
    input.collectionName
  );

  if (existingDimension === input.embeddingDimension) {
    return {
      ok: true,
      action: "unchanged",
      message: `Qdrant collection ${input.collectionName} already uses dimension ${String(input.embeddingDimension)}.`,
    };
  }

  if (existingDimension !== null) {
    const deleted = await runner.run("curl", [
      "-fsS",
      "-X",
      "DELETE",
      `http://localhost:6333/collections/${input.collectionName}`,
    ]);
    if (!deleted.success) {
      return {
        ok: false,
        action: "recreated",
        message: `Unable to delete Qdrant collection ${input.collectionName}.`,
      };
    }
  }

  const created = await runner.run("curl", [
    "-fsS",
    "-X",
    "PUT",
    `http://localhost:6333/collections/${input.collectionName}`,
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({
      vectors: {
        size: input.embeddingDimension,
        distance: "Cosine",
      },
    }),
  ]);
  if (!created.success) {
    return {
      ok: false,
      action: existingDimension === null ? "created" : "recreated",
      message: `Unable to create Qdrant collection ${input.collectionName} with dimension ${String(input.embeddingDimension)}.`,
    };
  }

  return {
    ok: true,
    action: existingDimension === null ? "created" : "recreated",
    message:
      existingDimension === null
        ? `Created Qdrant collection ${input.collectionName} with dimension ${String(input.embeddingDimension)}.`
        : `Recreated Qdrant collection ${input.collectionName} with dimension ${String(input.embeddingDimension)} (was ${String(existingDimension)}).`,
  };
}
