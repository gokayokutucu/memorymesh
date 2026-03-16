import { Ollama } from "ollama";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "localhost";
const OLLAMA_PORT = process.env.OLLAMA_PORT ?? "11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "nomic-embed-text";
const EMBED_CHUNK_MAX_CHARS = Number.parseInt(
  process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS ?? "3500",
  10
);
const EMBED_MAX_CONCURRENCY = Number.parseInt(
  process.env.MEMORYMESH_EMBED_MAX_CONCURRENCY ?? "2",
  10
);
const EMBED_MIN_CHUNK_CHARS = 400;

const client = new Ollama({ host: `http://${OLLAMA_HOST}:${OLLAMA_PORT}` });
let modelPreflightPromise: Promise<void> | null = null;

export async function embed(text: string): Promise<number[]> {
  await ensureEmbeddingModelAvailable();
  const maxChunkChars =
    Number.isNaN(EMBED_CHUNK_MAX_CHARS) || EMBED_CHUNK_MAX_CHARS <= 0
      ? 3500
      : EMBED_CHUNK_MAX_CHARS;
  const chunks = splitIntoChunks(text, maxChunkChars);
  if (chunks.length <= 1) {
    return embedChunk(chunks[0] ?? text);
  }

  const vectors = await mapWithConcurrency(chunks, getMaxConcurrency(), async (chunk) =>
    embedChunkWithFallback(chunk, maxChunkChars)
  );
  return meanPool(vectors);
}

export async function ensureEmbeddingModelAvailable(): Promise<void> {
  if (modelPreflightPromise) {
    return modelPreflightPromise;
  }

  modelPreflightPromise = verifyEmbeddingModelAvailability().catch((error) => {
    modelPreflightPromise = null;
    throw error;
  });
  return modelPreflightPromise;
}

async function verifyEmbeddingModelAvailability(): Promise<void> {
  let modelList: unknown;
  try {
    modelList = await client.list();
  } catch (error) {
    throw toPreflightError(
      "ollama_unreachable",
      `Ollama endpoint http://${OLLAMA_HOST}:${OLLAMA_PORT} is unreachable while checking embedding model "${EMBEDDING_MODEL}".`,
      error
    );
  }

  const availableModels = extractModelNames(modelList);
  const modelExists = availableModels.some((candidate) =>
    matchesConfiguredModel(candidate, EMBEDDING_MODEL)
  );
  if (modelExists) {
    return;
  }

  const modelSummary =
    availableModels.length > 0
      ? availableModels.slice(0, 10).join(", ")
      : "none";
  throw toPreflightError(
    "embedding_model_missing",
    `Ollama is reachable at http://${OLLAMA_HOST}:${OLLAMA_PORT} but embedding model "${EMBEDDING_MODEL}" is missing. Available models: ${modelSummary}. Run "ollama pull ${EMBEDDING_MODEL}" or use docker compose bootstrap.`,
    modelList
  );
}

async function embedChunk(text: string): Promise<number[]> {
  const response = await client.embeddings({
    model: EMBEDDING_MODEL,
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
  if (Number.isNaN(EMBED_MAX_CONCURRENCY) || EMBED_MAX_CONCURRENCY <= 0) {
    return 2;
  }
  return Math.min(8, EMBED_MAX_CONCURRENCY);
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
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
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
