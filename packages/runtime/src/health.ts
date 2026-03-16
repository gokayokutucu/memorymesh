import { getCircuitBreakerConfig } from "./config";

export type RuntimeStoreName = "qdrant" | "mongo" | "neo4j";
export type RuntimeStoreState = "healthy" | "degraded" | "open";

export interface IRuntimeStoreHealth {
  store: RuntimeStoreName;
  state: RuntimeStoreState;
  consecutive_failures: number;
  last_error?: string;
  last_failure_at?: string;
  opened_until?: string;
}

interface IRuntimeStoreHealthInternal {
  state: RuntimeStoreState;
  consecutiveFailures: number;
  lastError?: string;
  lastFailureAt?: number;
  openedUntil?: number;
}

const stores: RuntimeStoreName[] = ["qdrant", "mongo", "neo4j"];

const healthState: Record<RuntimeStoreName, IRuntimeStoreHealthInternal> = {
  qdrant: {
    state: "healthy",
    consecutiveFailures: 0,
  },
  mongo: {
    state: "healthy",
    consecutiveFailures: 0,
  },
  neo4j: {
    state: "healthy",
    consecutiveFailures: 0,
  },
};

export function onStoreSuccess(store: RuntimeStoreName): void {
  const state = healthState[store];
  state.state = "healthy";
  state.consecutiveFailures = 0;
  state.lastError = undefined;
  state.lastFailureAt = undefined;
  state.openedUntil = undefined;
}

export function onStoreFailure(
  store: RuntimeStoreName,
  error: unknown,
  transient: boolean
): void {
  const now = Date.now();
  const config = getCircuitBreakerConfig();
  const state = healthState[store];
  state.lastError = error instanceof Error ? error.message : String(error);
  state.lastFailureAt = now;

  if (!transient) {
    state.state = "degraded";
    return;
  }

  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= config.failureThreshold) {
    state.state = "open";
    state.openedUntil = now + config.openMs;
    console.warn(
      `[circuit] store=${store} state=open cooldown_ms=${config.openMs}`
    );
    return;
  }

  state.state = "degraded";
}

export function canExecuteStore(store: RuntimeStoreName): boolean {
  const now = Date.now();
  const state = healthState[store];
  if (state.state !== "open") {
    return true;
  }

  if (!state.openedUntil || state.openedUntil <= now) {
    // Half-open probe window.
    state.state = "degraded";
    state.consecutiveFailures = Math.max(0, state.consecutiveFailures - 1);
    state.openedUntil = undefined;
    console.warn(`[circuit] store=${store} state=half_open`);
    return true;
  }

  return false;
}

export function getRuntimeHealth(): Record<RuntimeStoreName, IRuntimeStoreHealth> {
  return {
    qdrant: toPublicStoreHealth("qdrant"),
    mongo: toPublicStoreHealth("mongo"),
    neo4j: toPublicStoreHealth("neo4j"),
  };
}

export function getStoreHealth(store: RuntimeStoreName): IRuntimeStoreHealth {
  return toPublicStoreHealth(store);
}

export function resetRuntimeHealthForTests(): void {
  for (const store of stores) {
    healthState[store] = {
      state: "healthy",
      consecutiveFailures: 0,
    };
  }
}

function toPublicStoreHealth(store: RuntimeStoreName): IRuntimeStoreHealth {
  const state = healthState[store];
  return {
    store,
    state: state.state,
    consecutive_failures: state.consecutiveFailures,
    last_error: state.lastError,
    last_failure_at: state.lastFailureAt
      ? new Date(state.lastFailureAt).toISOString()
      : undefined,
    opened_until: state.openedUntil
      ? new Date(state.openedUntil).toISOString()
      : undefined,
  };
}
