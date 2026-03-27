import { Ollama } from "ollama";
import { resolveEmbeddingConfig } from "./embedding-config";

const EMBED_MIN_CHUNK_CHARS = 400;
const modelPreflightByTarget = new Map<string, Promise<void>>();

export async function embed(text: string): Promise<number[]> {
  await ensureEmbeddingModelAvailable();
  const maxChunkChars = getMaxChunkChars();
  const chunks = splitIntoChunks(text, maxChunkChars);
  if (chunks.length <= 1) {
    return embedChunkWithFallback(chunks[0] ?? text, maxChunkChars);
  }

  const vectors = await mapWithConcurrency(chunks, getMaxConcurrency(), async (chunk) =>
    embedChunkWithFallback(chunk, maxChunkChars)
  );
  return meanPool(vectors);
}

export async function ensureEmbeddingModelAvailable(): Promise<void> {
  const key = getPreflightKey();
  const existing = modelPreflightByTarget.get(key);
  if (existing) {
    return existing;
  }

  const task = verifyEmbeddingModelAvailability().catch((error) => {
    modelPreflightByTarget.delete(key);
    throw error;
  });
  modelPreflightByTarget.set(key, task);
  return task;
}

export function resetEmbeddingPreflightForTests(): void {
  modelPreflightByTarget.clear();
}

async function verifyEmbeddingModelAvailability(): Promise<void> {
  const { embeddingModel } = resolveEmbeddingConfig();
  const { hostLabel, client } = getOllamaClient();
  let modelList: unknown;
  try {
    modelList = await client.list();
  } catch (error) {
    throw toPreflightError(
      "ollama_unreachable",
      `Ollama endpoint ${hostLabel} is unreachable while checking embedding model "${embeddingModel}".`,
      error
    );
  }

  const availableModels = extractModelNames(modelList);
  const modelExists = availableModels.some((candidate) =>
    matchesConfiguredModel(candidate, embeddingModel)
  );
  if (modelExists) {
    return;
  }

  const modelSummary =
    availableModels.length > 0 ? availableModels.slice(0, 10).join(", ") : "none";
  throw toPreflightError(
    "embedding_model_missing",
    `Ollama is reachable at ${hostLabel} but embedding model "${embeddingModel}" is missing. Available models: ${modelSummary}. Run "ollama pull ${embeddingModel}" or use docker compose bootstrap.`,
    modelList
  );
}

async function embedChunk(text: string): Promise<number[]> {
  const { embeddingModel } = resolveEmbeddingConfig();
  const { client } = getOllamaClient();
  const response = await client.embeddings({
    model: embeddingModel,
    prompt: text,
  });
  return response.embedding;
}

async function embedChunkWithFallback(
  text: string,
  maxChunkChars: number
): Promise<number[]> {
  try {
    return await embedChunk(text);
  } catch (error) {
    if (!isContextLengthError(error) || text.length <= EMBED_MIN_CHUNK_CHARS) {
      throw toEmbeddingInputTooLargeError(error);
    }

    const nextSize = Math.max(
      EMBED_MIN_CHUNK_CHARS,
      Math.floor(Math.min(maxChunkChars, text.length) / 2)
    );
    const subChunks = splitIntoChunks(text, nextSize);
    if (subChunks.length <= 1) {
      throw toEmbeddingInputTooLargeError(error);
    }
    const vectors = await mapWithConcurrency(
      subChunks,
      getMaxConcurrency(),
      async (subChunk) => embedChunkWithFallback(subChunk, nextSize)
    );
    return meanPool(vectors);
  }
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  maxConcurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      if (index >= items.length) {
        return;
      }
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));
  await Promise.all(new Array(workerCount).fill(null).map(async () => worker()));
  return results;
}

function getMaxConcurrency(): number {
  const raw = Number.parseInt(
    process.env.MEMORYMESH_EMBED_MAX_CONCURRENCY ?? "2",
    10
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return 2;
  }
  return Math.min(8, raw);
}

function getMaxChunkChars(): number {
  const raw = Number.parseInt(
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS ?? "3500",
    10
  );
  if (Number.isNaN(raw) || raw <= 0) {
    return 3500;
  }
  return raw;
}

function getOllamaClient(): { hostLabel: string; client: Ollama } {
  const host = process.env.OLLAMA_HOST?.trim() || "localhost";
  const port = process.env.OLLAMA_PORT?.trim() || "11434";
  const hostLabel = `http://${host}:${port}`;
  return {
    hostLabel,
    client: new Ollama({ host: hostLabel }),
  };
}

function getPreflightKey(): string {
  const { embeddingModel } = resolveEmbeddingConfig();
  const host = process.env.OLLAMA_HOST?.trim() || "localhost";
  const port = process.env.OLLAMA_PORT?.trim() || "11434";
  return `${host}:${port}:${embeddingModel}`;
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const breakAt = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf(" ", end)
      );
      if (breakAt > start + Math.floor(maxChars * 0.5)) {
        end = breakAt;
      }
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end;
  }
  return chunks.length > 0 ? chunks : [normalized];
}

function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw toEmbeddingInputTooLargeError(new Error("no_embedding_chunks"));
  }
  const dimension = vectors[0].length;
  const acc = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      throw toEmbeddingInputTooLargeError(new Error("embedding_dimension_mismatch"));
    }
    for (let i = 0; i < dimension; i += 1) {
      acc[i] += vector[i];
    }
  }
  return acc.map((value) => value / vectors.length);
}

function isContextLengthError(error: unknown): boolean {
  const message = normalizeEmbeddingErrorText(error).toLowerCase();
  return (
    message.includes("context length") ||
    message.includes("input length exceeds") ||
    message.includes("too many tokens")
  );
}

function toEmbeddingInputTooLargeError(error: unknown): Error {
  const wrapped = new Error(
    error instanceof Error ? error.message : "embedding_input_too_large"
  ) as Error & { code?: string };
  wrapped.code = "embedding_input_too_large";
  return wrapped;
}

function extractModelNames(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }
  const models = input.models;
  if (!Array.isArray(models)) {
    return [];
  }
  const names: string[] = [];
  for (const model of models) {
    if (typeof model === "string" && model.trim().length > 0) {
      names.push(model.trim());
      continue;
    }
    if (isRecord(model)) {
      const byName = model.name;
      if (typeof byName === "string" && byName.trim().length > 0) {
        names.push(byName.trim());
        continue;
      }
      const byModel = model.model;
      if (typeof byModel === "string" && byModel.trim().length > 0) {
        names.push(byModel.trim());
      }
    }
  }
  return names;
}

function matchesConfiguredModel(candidate: string, configured: string): boolean {
  if (candidate === configured) {
    return true;
  }
  if (configured.includes(":")) {
    return false;
  }
  return candidate.startsWith(`${configured}:`);
}

function toPreflightError(code: string, message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown };
  error.code = code;
  error.cause = cause;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEmbeddingErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  const addText = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  };

  const walk = (value: unknown, depth: number): void => {
    if (depth > 3 || value === null || value === undefined) {
      return;
    }
    if (seen.has(value)) {
      return;
    }

    if (typeof value === "string") {
      addText(value);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      addText(String(value));
      return;
    }
    if (value instanceof Error) {
      seen.add(value);
      addText(value.name);
      addText(value.message);
      walk((value as Error & { cause?: unknown }).cause, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      seen.add(value);
      for (const item of value) {
        walk(item, depth + 1);
      }
      return;
    }
    if (!isRecord(value)) {
      addText(String(value));
      return;
    }

    seen.add(value);
    const preferredKeys = [
      "message",
      "name",
      "error",
      "statusText",
      "status",
      "code",
      "type",
      "cause",
      "body",
      "response",
      "details",
    ];
    for (const key of preferredKeys) {
      if (key in value) {
        walk(value[key], depth + 1);
      }
    }
  };

  walk(error, 0);
  if (parts.length === 0) {
    addText(String(error));
  }
  return parts.join(" | ");
}
