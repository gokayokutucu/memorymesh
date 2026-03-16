import { getRetryConfig } from "./config";
import {
  canExecuteStore,
  onStoreFailure,
  onStoreSuccess,
} from "./health";

export interface IRetryOptions {
  store: "qdrant" | "mongo" | "neo4j";
  operation: string;
  isTransient: (error: unknown) => boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
  transientFailureCode?: string;
}

interface IErrorWithCode extends Error {
  code?: string;
}

interface IErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

export class RuntimeStoreError extends Error {
  code: string;
  store: IRetryOptions["store"];
  operation: string;

  constructor(
    code: string,
    store: IRetryOptions["store"],
    operation: string,
    message: string
  ) {
    super(message);
    this.name = "RuntimeStoreError";
    this.code = code;
    this.store = store;
    this.operation = operation;
  }
}

export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMs: number
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  if (jitterMs <= 0) {
    return exponential;
  }
  const jitter = Math.floor(Math.random() * (jitterMs + 1));
  return Math.min(maxDelayMs, exponential + jitter);
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: IRetryOptions
): Promise<T> {
  const retryConfig = getRetryConfig();
  const maxAttempts = options.maxAttempts ?? retryConfig.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? retryConfig.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? retryConfig.maxDelayMs;
  const jitterMs = options.jitterMs ?? retryConfig.jitterMs;
  const timeoutMs = options.timeoutMs;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!canExecuteStore(options.store)) {
      throw new RuntimeStoreError(
        `${options.store}_circuit_open`,
        options.store,
        options.operation,
        `${options.store} circuit is open`
      );
    }

    try {
      if (timeoutMs && timeoutMs > 0) {
        const result = await withTimeout(
          fn(),
          timeoutMs,
          options.store,
          options.operation
        );
        onStoreSuccess(options.store);
        return result;
      }
      const result = await fn();
      onStoreSuccess(options.store);
      return result;
    } catch (error) {
      lastError = error;
      const transient = options.isTransient(error);
      const hasMoreAttempts = attempt < maxAttempts;
      onStoreFailure(options.store, error, transient);

      console.warn(
        `[resilience] store=${options.store} op=${options.operation} attempt=${attempt}/${maxAttempts} transient=${transient}`
      );

      if (!transient) {
        throw error;
      }

      if (!hasMoreAttempts) {
        const code = options.transientFailureCode ?? `${options.store}_transient_failure`;
        const message = `${options.store} transient failure after ${maxAttempts} attempts: ${formatErrorMessage(error)}`;
        throw new RuntimeStoreError(code, options.store, options.operation, message);
      }

      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterMs);
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function isTransientQdrantError(error: unknown): boolean {
  const normalized = normalizeError(error);
  const status = normalized.status;
  if (typeof status === "number" && (status >= 500 || status === 429)) {
    return true;
  }

  const code = (normalized.code ?? "").toUpperCase();
  if (
    code.includes("ECONNRESET") ||
    code.includes("ECONNREFUSED") ||
    code.includes("ETIMEDOUT") ||
    code.includes("UND_ERR_SOCKET")
  ) {
    return true;
  }

  return /fetch failed|socket|network|timed out|temporarily unavailable|service unavailable|econnreset|econnrefused/i.test(
    normalized.message
  );
}

export function isTransientMongoError(error: unknown): boolean {
  const normalized = normalizeError(error);
  const code = (normalized.code ?? "").toUpperCase();
  if (
    code.includes("ECONNRESET") ||
    code.includes("ECONNREFUSED") ||
    code.includes("ETIMEDOUT")
  ) {
    return true;
  }

  return /MongoNetworkError|MongoServerSelectionError|topology was destroyed|connection.*closed|timed out|network/i.test(
    `${normalized.name} ${normalized.message}`
  );
}

export function isTransientNeo4jError(error: unknown): boolean {
  const normalized = normalizeError(error);
  const code = normalized.code ?? "";
  if (code.startsWith("Neo.TransientError")) {
    return true;
  }

  return /ServiceUnavailable|SessionExpired|TransientError|connection|socket|timed out|network/i.test(
    `${normalized.name} ${normalized.message}`
  );
}

function normalizeError(error: unknown): {
  name: string;
  message: string;
  code?: string;
  status?: number;
} {
  if (error instanceof Error) {
    const maybeCode = (error as IErrorWithCode).code;
    const maybeStatus = (error as IErrorWithStatus).status ?? (error as IErrorWithStatus).statusCode;
    return {
      name: error.name,
      message: error.message,
      code: typeof maybeCode === "string" ? maybeCode : undefined,
      status: typeof maybeStatus === "number" ? maybeStatus : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = "message" in error ? String((error as { message?: unknown }).message) : String(error);
    const maybeCode = "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const maybeStatus = "status" in error
      ? Number((error as { status?: unknown }).status)
      : "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;
    return {
      name: "Error",
      message: maybeMessage,
      code: Number.isNaN(maybeStatus) ? maybeCode : maybeCode,
      status: maybeStatus,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  store: IRetryOptions["store"],
  operation: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new RuntimeStoreError(
              `${store}_transient_failure`,
              store,
              operation,
              `${store} operation timed out after ${timeoutMs}ms`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
