import {
  canExecuteStore,
  getStoreHealth,
  onStoreFailure,
  onStoreSuccess,
  resetRuntimeHealthForTests,
} from "../health";

describe("runtime health circuit state", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRuntimeHealthForTests();
    process.env.MEMORYMESH_CIRCUIT_BREAKER_FAILURE_THRESHOLD = "2";
    process.env.MEMORYMESH_CIRCUIT_BREAKER_OPEN_MS = "1000";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("opens circuit after repeated transient failures", () => {
    onStoreFailure("qdrant", new Error("network"), true);
    expect(getStoreHealth("qdrant").state).toBe("degraded");

    onStoreFailure("qdrant", new Error("network"), true);
    expect(getStoreHealth("qdrant").state).toBe("open");
    expect(canExecuteStore("qdrant")).toBe(false);
  });

  it("allows half-open probe after cooldown", () => {
    const dateNowSpy = jest.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(1000);
    onStoreFailure("mongo", new Error("timeout"), true);
    onStoreFailure("mongo", new Error("timeout"), true);
    expect(canExecuteStore("mongo")).toBe(false);

    dateNowSpy.mockReturnValue(2200);
    expect(canExecuteStore("mongo")).toBe(true);
    expect(getStoreHealth("mongo").state).toBe("degraded");
    dateNowSpy.mockRestore();
  });

  it("moves back to healthy on success", () => {
    onStoreFailure("neo4j", new Error("temporary"), true);
    expect(getStoreHealth("neo4j").state).toBe("degraded");
    onStoreSuccess("neo4j");
    const health = getStoreHealth("neo4j");
    expect(health.state).toBe("healthy");
    expect(health.consecutive_failures).toBe(0);
  });
});
