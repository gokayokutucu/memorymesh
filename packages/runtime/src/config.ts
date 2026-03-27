export type RetrievalMode = "preview" | "full" | "adaptive";

export interface IRetrievalConfig {
  mode: RetrievalMode;
  previewMaxChars: number;
  previewMaxLines: number;
  adaptiveThreshold: number;
}

export interface ISavePayloadConfig {
  maxPayloadBytes: number;
}

export interface IProfilerConfig {
  enabled: boolean;
}

export interface IMemoryPermissionConfig {
  readEnabled: boolean;
  writeEnabled: boolean;
}

export interface IRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export interface ICircuitBreakerConfig {
  failureThreshold: number;
  openMs: number;
}

export function getRetrievalConfig(): IRetrievalConfig {
  return {
    mode: parseRetrievalMode(process.env.MEMORYMESH_RETRIEVAL_MODE),
    previewMaxChars: parsePositiveInt(process.env.MEMORYMESH_PREVIEW_MAX_CHARS, 500),
    previewMaxLines: parsePositiveInt(process.env.MEMORYMESH_PREVIEW_MAX_LINES, 12),
    adaptiveThreshold: parsePositiveInt(process.env.MEMORYMESH_ADAPTIVE_THRESHOLD, 800),
  };
}

export function getSavePayloadConfig(): ISavePayloadConfig {
  return {
    maxPayloadBytes: parsePositiveInt(
      process.env.MEMORYMESH_MAX_SAVE_PAYLOAD_BYTES,
      262144
    ),
  };
}

export function getProfilerConfig(): IProfilerConfig {
  return {
    enabled: parseBoolean(process.env.MEMORYMESH_ENABLE_PROFILER_LOGS),
  };
}

export function getMemoryPermissionConfig(): IMemoryPermissionConfig {
  return {
    readEnabled: parseBooleanWithDefault(
      process.env.MEMORYMESH_MEMORY_READ_ENABLED,
      true
    ),
    writeEnabled: parseBooleanWithDefault(
      process.env.MEMORYMESH_MEMORY_WRITE_ENABLED,
      true
    ),
  };
}

export function getRetryConfig(): IRetryConfig {
  return {
    maxAttempts: parsePositiveInt(process.env.MEMORYMESH_RETRY_MAX_ATTEMPTS, 3),
    baseDelayMs: parseNonNegativeInt(
      process.env.MEMORYMESH_RETRY_BASE_DELAY_MS,
      150
    ),
    maxDelayMs: parseNonNegativeInt(
      process.env.MEMORYMESH_RETRY_MAX_DELAY_MS,
      1500
    ),
    jitterMs: parseNonNegativeInt(process.env.MEMORYMESH_RETRY_JITTER_MS, 50),
  };
}

export function getCircuitBreakerConfig(): ICircuitBreakerConfig {
  return {
    failureThreshold: parsePositiveInt(
      process.env.MEMORYMESH_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      3
    ),
    openMs: parsePositiveInt(process.env.MEMORYMESH_CIRCUIT_BREAKER_OPEN_MS, 10000),
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

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseBooleanWithDefault(
  value: string | undefined,
  fallback: boolean
): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return fallback;
}
