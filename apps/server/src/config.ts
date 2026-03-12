export type RetrievalMode = "preview" | "full" | "adaptive";

export interface IRetrievalConfig {
  mode: RetrievalMode;
  previewMaxChars: number;
  previewMaxLines: number;
  adaptiveThreshold: number;
}

export function getRetrievalConfig(): IRetrievalConfig {
  return {
    mode: parseRetrievalMode(process.env.MEMORYMESH_RETRIEVAL_MODE),
    previewMaxChars: parsePositiveInt(process.env.MEMORYMESH_PREVIEW_MAX_CHARS, 500),
    previewMaxLines: parsePositiveInt(process.env.MEMORYMESH_PREVIEW_MAX_LINES, 12),
    adaptiveThreshold: parsePositiveInt(process.env.MEMORYMESH_ADAPTIVE_THRESHOLD, 800),
  };
}

function parseRetrievalMode(value: string | undefined): RetrievalMode {
  if (value === "full" || value === "adaptive" || value === "preview") {
    return value;
  }
  return "preview";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
