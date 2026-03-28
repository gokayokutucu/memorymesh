const mockSaveMemoryForImport = jest.fn();
const mockGetMemoryStatus = jest.fn();
const mockGetMemoryByRef = jest.fn();
const mockDeleteMemoriesByIds = jest.fn();
const mockWaitForBackgroundSaveTasks = jest.fn();

jest.mock("../memory", () => ({
  saveMemoryForImport: (...args: unknown[]) => mockSaveMemoryForImport(...args),
  getMemoryStatus: (...args: unknown[]) => mockGetMemoryStatus(...args),
  getMemoryByRef: (...args: unknown[]) => mockGetMemoryByRef(...args),
  deleteMemoriesByIds: (...args: unknown[]) => mockDeleteMemoriesByIds(...args),
  waitForBackgroundSaveTasks: (...args: unknown[]) => mockWaitForBackgroundSaveTasks(...args),
}));

describe("RuntimeImporterGateway", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockWaitForBackgroundSaveTasks.mockResolvedValue(undefined);
    delete process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS;
  });

  it("uses saveMemoryForImport for writes", async () => {
    mockSaveMemoryForImport.mockReturnValue({ id: "id-1", status: "saved" });
    mockGetMemoryStatus.mockReturnValue({ id: "id-1", status: "saved" });

    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await gateway.saveMemory({
      content: "import",
      project: "MemoryMesh",
      memory_type: "context",
    });

    expect(mockSaveMemoryForImport).toHaveBeenCalledTimes(1);
  });

  it("throws when final status is partial", async () => {
    mockSaveMemoryForImport.mockReturnValue({ id: "id-1", status: "saved" });
    mockGetMemoryStatus.mockReturnValue({ id: "id-1", status: "partial" });

    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await expect(
      gateway.saveMemory({
        content: "import",
        project: "MemoryMesh",
        memory_type: "context",
      })
    ).rejects.toMatchObject({ message: "partial_persistence", code: "partial_persistence" });
  });

  it("throws when final status remains pending until timeout", async () => {
    mockSaveMemoryForImport.mockReturnValue({ id: "id-1", status: "saved" });
    mockGetMemoryStatus.mockReturnValue({ id: "id-1", status: "pending" });
    process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS = "1";

    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await expect(
      gateway.saveMemory({
        content: "import",
        project: "MemoryMesh",
        memory_type: "context",
      })
    ).rejects.toMatchObject({
      message: "save_status_pending_timeout",
      code: "save_status_pending_timeout",
    });
    expect(mockWaitForBackgroundSaveTasks).toHaveBeenCalledTimes(1);

    delete process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS;
  });

  it("recovers from poll timeout when background save drains to terminal status", async () => {
    mockSaveMemoryForImport.mockReturnValue({ id: "id-1", status: "saved" });
    mockGetMemoryStatus
      .mockReturnValueOnce({ id: "id-1", status: "pending" })
      .mockReturnValueOnce({ id: "id-1", status: "pending" })
      .mockReturnValueOnce({ id: "id-1", status: "saved" });
    process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS = "1";

    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await expect(
      gateway.saveMemory({
        content: "import",
        project: "MemoryMesh",
        memory_type: "context",
      })
    ).resolves.toBeUndefined();
    expect(mockWaitForBackgroundSaveTasks).toHaveBeenCalledTimes(1);

    delete process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS;
  });

  it("throws ImportInterruptedError when save status reports import interruption", async () => {
    mockSaveMemoryForImport.mockReturnValue({ id: "id-1", status: "saved" });
    mockGetMemoryStatus.mockReturnValue({
      id: "id-1",
      status: "failed",
      error_code: "import_interrupted",
    });

    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await expect(
      gateway.saveMemory({
        content: "import",
        project: "MemoryMesh",
        memory_type: "context",
      })
    ).rejects.toMatchObject({
      name: "ImportInterruptedError",
      code: "import_interrupted",
    });
  });

  it("deletes memories by ids for overwrite support", async () => {
    const { RuntimeImporterGateway } = await import("../importer-runtime-gateway");
    const gateway = new RuntimeImporterGateway();

    await gateway.deleteMemoriesByIds(["a", "b"]);

    expect(mockDeleteMemoriesByIds).toHaveBeenCalledWith(["a", "b"]);
  });
});
