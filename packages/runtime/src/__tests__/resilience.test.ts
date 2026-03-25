import {
  RuntimeStoreError,
  computeBackoffDelay,
  executeWithRetry,
  isTransientMongoError,
  isTransientNeo4jError,
  isTransientQdrantError,
} from "../resilience";
import { resetRuntimeHealthForTests } from "../health";

describe("resilience", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    resetRuntimeHealthForTests();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("computes deterministic backoff when jitter is disabled", () => {
    expect(computeBackoffDelay(1, 100, 1000, 0)).toBe(100);
    expect(computeBackoffDelay(2, 100, 1000, 0)).toBe(200);
    expect(computeBackoffDelay(3, 100, 1000, 0)).toBe(400);
    expect(computeBackoffDelay(5, 100, 500, 0)).toBe(500);
  });

  it("retries transient failures and eventually succeeds", async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce("ok");

    const result = await executeWithRetry(fn, {
      store: "qdrant",
      operation: "search",
      isTransient: isTransientQdrantError,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterMs: 0,
      transientFailureCode: "qdrant_transient_failure",
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    const permanent = new Error("invalid filter payload");
    const fn = jest.fn<Promise<string>, []>().mockRejectedValue(permanent);

    await expect(
      executeWithRetry(fn, {
        store: "qdrant",
        operation: "search",
        isTransient: () => false,
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      })
    ).rejects.toThrow("invalid filter payload");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("raises stable error code when transient retries are exhausted", async () => {
    const fn = jest.fn<Promise<string>, []>().mockRejectedValue(new Error("socket closed"));

    await expect(
      executeWithRetry(fn, {
        store: "qdrant",
        operation: "upsert",
        isTransient: isTransientQdrantError,
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
        transientFailureCode: "qdrant_transient_failure",
      })
    ).rejects.toMatchObject({
      name: "RuntimeStoreError",
      code: "qdrant_transient_failure",
    });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("classifies transient errors per store", () => {
    expect(isTransientQdrantError(new Error("fetch failed: socket closed"))).toBe(
      true
    );
    expect(
      isTransientMongoError(
        Object.assign(new Error("Server selection timed out"), {
          name: "MongoServerSelectionError",
        })
      )
    ).toBe(true);
    expect(
      isTransientNeo4jError(
        Object.assign(new Error("temporary"), {
          code: "Neo.TransientError.General.DatabaseUnavailable",
        })
      )
    ).toBe(true);
  });

  it("RuntimeStoreError carries store and operation context", () => {
    const error = new RuntimeStoreError(
      "mongo_transient_failure",
      "mongo",
      "findOne",
      "mongo transient failure"
    );
    expect(error.code).toBe("mongo_transient_failure");
    expect(error.store).toBe("mongo");
    expect(error.operation).toBe("findOne");
  });

  it("fails fast when circuit is open and allows retry after cooldown", async () => {
    process.env.MEMORYMESH_CIRCUIT_BREAKER_FAILURE_THRESHOLD = "1";
    process.env.MEMORYMESH_CIRCUIT_BREAKER_OPEN_MS = "1000";
    const dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1000);

    const alwaysFail = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new Error("fetch failed"));
    await expect(
      executeWithRetry(alwaysFail, {
        store: "qdrant",
        operation: "search",
        isTransient: isTransientQdrantError,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      })
    ).rejects.toMatchObject({
      code: "qdrant_transient_failure",
    });

    const shouldNotRun = jest.fn<Promise<string>, []>().mockResolvedValue("ok");
    await expect(
      executeWithRetry(shouldNotRun, {
        store: "qdrant",
        operation: "search",
        isTransient: isTransientQdrantError,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      })
    ).rejects.toMatchObject({
      code: "qdrant_circuit_open",
    });
    expect(shouldNotRun).toHaveBeenCalledTimes(0);

    dateNowSpy.mockReturnValue(2500);
    const success = jest.fn<Promise<string>, []>().mockResolvedValue("ok");
    await expect(
      executeWithRetry(success, {
        store: "qdrant",
        operation: "search",
        isTransient: isTransientQdrantError,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterMs: 0,
      })
    ).resolves.toBe("ok");
    dateNowSpy.mockRestore();
  });
});
