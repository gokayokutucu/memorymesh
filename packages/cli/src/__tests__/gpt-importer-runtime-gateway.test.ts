import type { IImporterGateway } from "@memorymesh/core";

const mockGateway: IImporterGateway = {
  async saveMemory(): Promise<void> {},
  async getMemoryByRef(): Promise<never[]> {
    return [];
  },
};

const mockCreateRuntimeImporterGateway = jest.fn(() => mockGateway);

jest.mock("@memorymesh/runtime", () => ({
  createRuntimeImporterGateway: () => mockCreateRuntimeImporterGateway(),
  ensureEmbeddingModelAvailable: jest.fn(async () => undefined),
  waitForBackgroundSaveTasks: jest.fn(async () => undefined),
}));

describe("gpt-importer runtime gateway wiring", () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateRuntimeImporterGateway.mockClear();
    process.env.MEMORYMESH_IMPORT_GATEWAY_MODE = "local";
  });

  afterEach(() => {
    delete process.env.MEMORYMESH_IMPORT_GATEWAY_MODE;
  });

  it("uses runtime gateway by default in local mode", async () => {
    const { importConversations } = await import("../gpt-importer");
    await importConversations(
      [
        {
          title: "Conv",
          messages: [{ role: "assistant", content: "Decision: use Postgres." }],
        },
      ],
      "MemoryMesh",
      true,
      { delayMs: 0 }
    );

    expect(mockCreateRuntimeImporterGateway).toHaveBeenCalledTimes(1);
  });
});
