import { createMemoryService } from "../application/memory-service";
import { IMemoryGateway } from "../application/memory-gateway";
import { ISaveMemoryInput, ISaveMemoryResult, ISearchResult } from "../types";

function createGatewayMock(): jest.Mocked<IMemoryGateway> {
  return {
    save: jest.fn((input: ISaveMemoryInput): ISaveMemoryResult => ({ id: input.project, status: "pending" })),
    getStatus: jest.fn(),
    search: jest.fn(async (_input): Promise<ISearchResult[]> => []),
    getById: jest.fn(),
    getByRef: jest.fn(),
    getRelated: jest.fn(),
    listProjects: jest.fn(),
  };
}

describe("createMemoryService", () => {
  it("normalizes empty project to general on save", () => {
    const gateway = createGatewayMock();

    const service = createMemoryService(gateway);
    service.saveMemory({ content: "x", project: "", memory_type: "context" });

    expect(gateway.save).toHaveBeenCalledWith(
      expect.objectContaining({ project: "general" })
    );
  });

  it("applies default limits for search/getByRef/getRelated", async () => {
    const gateway = createGatewayMock();
    gateway.search.mockResolvedValue([]);
    gateway.getByRef.mockResolvedValue([]);
    gateway.getRelated.mockResolvedValue([]);

    const service = createMemoryService(gateway);
    await service.searchMemory({ query: "auth" });
    await service.getMemoryByRef({ ref_id: "MM-1" });
    await service.getRelatedMemories({ id: "abc" });

    expect(gateway.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
    expect(gateway.getByRef).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
    expect(gateway.getRelated).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 })
    );
  });

  it("works with different gateway adapters without transport-specific leakage", async () => {
    const serverGateway = createGatewayMock();
    const cliGateway = createGatewayMock();

    const serverService = createMemoryService(serverGateway);
    const cliService = createMemoryService(cliGateway);

    serverService.saveMemory({
      content: "server message",
      project: "ServerApp",
      memory_type: "context",
    });
    await cliService.searchMemory({ query: "importer pipeline" });

    expect(serverGateway.save).toHaveBeenCalledWith(
      expect.objectContaining({ project: "ServerApp" })
    );
    expect(cliGateway.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "importer pipeline", limit: 5 })
    );
  });
});
