export interface IResolvedEmbeddingConfig {
  embeddingMode: "flash" | "medium";
  embeddingModel: "nomic-embed-text" | "mxbai-embed-large";
  embeddingDimension: number;
}

const MODEL_BY_MODE: Record<"flash" | "medium", IResolvedEmbeddingConfig["embeddingModel"]> = {
  flash: "nomic-embed-text",
  medium: "mxbai-embed-large",
};

const DIMENSION_BY_MODEL: Record<IResolvedEmbeddingConfig["embeddingModel"], number> = {
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
};

export function resolveEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env
): IResolvedEmbeddingConfig {
  const modelRaw = env.EMBEDDING_MODEL?.trim();
  const modeRaw = env.MEMORYMESH_EMBEDDING_MODE?.trim();
  const dimensionRaw = env.MEMORYMESH_EMBEDDING_DIMENSION?.trim();

  if (!modelRaw) {
    throw new Error(
      "EMBEDDING_MODEL is required. Run setup again to regenerate ~/.memorymesh/runtime.env."
    );
  }
  if (modelRaw !== "nomic-embed-text" && modelRaw !== "mxbai-embed-large") {
    throw new Error(`Unsupported EMBEDDING_MODEL: ${modelRaw}`);
  }

  const inferredMode = modelRaw === "nomic-embed-text" ? "flash" : "medium";
  const expectedDimension = DIMENSION_BY_MODEL[modelRaw];
  const parsedDimension =
    typeof dimensionRaw === "string" && dimensionRaw.length > 0
      ? Number.parseInt(dimensionRaw, 10)
      : expectedDimension;
  if (!Number.isFinite(parsedDimension)) {
    throw new Error(
      `Invalid MEMORYMESH_EMBEDDING_DIMENSION: ${dimensionRaw ?? "empty"}`
    );
  }
  if (parsedDimension !== expectedDimension) {
    throw new Error(
      `Embedding configuration mismatch. model=${modelRaw} requires dimension=${expectedDimension}, got=${parsedDimension}.`
    );
  }

  let parsedMode: "flash" | "medium" | undefined;
  if (modeRaw === "flash" || modeRaw === "medium") {
    parsedMode = modeRaw;
  } else if (modeRaw) {
    throw new Error(`Unsupported MEMORYMESH_EMBEDDING_MODE: ${modeRaw}`);
  }
  const embeddingMode: "flash" | "medium" = parsedMode ?? inferredMode;
  if (MODEL_BY_MODE[embeddingMode] !== modelRaw) {
    throw new Error(
      `Embedding configuration mismatch. mode=${embeddingMode} expects model=${MODEL_BY_MODE[embeddingMode]}, got=${modelRaw}.`
    );
  }

  return {
    embeddingMode,
    embeddingModel: modelRaw,
    embeddingDimension: parsedDimension,
  };
}
