import { parseSearchArgs, runSearchCommand } from "../commands/search";

describe("search command", () => {
  const authority = {
    runtimeEnv: {
      EMBEDDING_MODEL: "mxbai-embed-large",
      MEMORYMESH_EMBEDDING_MODE: "medium",
      MEMORYMESH_EMBEDDING_DIMENSION: "1024",
    } as NodeJS.ProcessEnv,
  };

  afterEach(() => {
    delete process.env.EMBEDDING_MODEL;
    delete process.env.MEMORYMESH_EMBEDDING_MODE;
    delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
  });

  it("parses query args", () => {
    expect(parseSearchArgs(["--query", "hello"])).toEqual({
      query: "hello",
      limit: 5,
      project: undefined,
    });
  });

  it("returns error if query is missing", async () => {
    const result = await runSearchCommand([]);
    expect(result.ok).toBe(false);
  });

  it("invokes runtime search and normalizes results", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const search = jest.fn().mockImplementation(async () => {
      expect(process.env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
      expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
      expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
      return [{ preview: "A", content: "A content", source_type: "chatgpt" }];
    });
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);
    const result = await runSearchCommand(["--query", "hello"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(resolveEmbeddingAuthority).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      query: "hello",
      limit: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([{ snippet: "A", source: "chatgpt" }]);
    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("returns failure when runtime search throws", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";
    const search = jest.fn().mockRejectedValue(new Error("runtime down"));
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);
    const result = await runSearchCommand(["--query", "hello"], {
      search,
      resolveEmbeddingAuthority,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Search failed");
    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });
});
