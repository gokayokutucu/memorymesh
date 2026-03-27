import { ICommandRunner } from "../system/command-runner";

interface IQdrantCollectionResponse {
  result?: {
    config?: {
      params?: {
        vectors?: { size?: number } | null;
        vector_size?: number;
      };
    };
  };
}

export async function detectQdrantCollectionDimension(
  runner: ICommandRunner,
  collectionName: string
): Promise<number | null> {
  const result = await runner.run("curl", [
    "-fsS",
    `http://localhost:6333/collections/${collectionName}`,
  ]);
  if (!result.success) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as IQdrantCollectionResponse;
    const size =
      parsed.result?.config?.params?.vectors?.size
      ?? parsed.result?.config?.params?.vector_size
      ?? null;
    return typeof size === "number" ? size : null;
  } catch {
    return null;
  }
}
