const embeddingsMock = jest.fn();
const listMock = jest.fn();

jest.mock("ollama", () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    embeddings: embeddingsMock,
    list: listMock,
  })),
}));

describe("embed", () => {
  beforeEach(() => {
    jest.resetModules();
    embeddingsMock.mockReset();
    listMock.mockReset();
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "10";
    process.env.MEMORYMESH_EMBED_MAX_CONCURRENCY = "2";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";
    listMock.mockResolvedValue({
      models: [{ name: "nomic-embed-text:latest" }],
    });
  });

  it("uses single-pass embedding for short content", async () => {
    embeddingsMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    const { embed } = await import("../embeddings");

    const vector = await embed("short");

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(embeddingsMock).toHaveBeenCalledTimes(1);
  });

  it("uses chunked embedding and mean pooling for long content", async () => {
    embeddingsMock
      .mockResolvedValueOnce({ embedding: [1, 1, 1] })
      .mockResolvedValueOnce({ embedding: [3, 3, 3] });
    const { embed } = await import("../embeddings");

    const vector = await embed("abcdefghijABCDEFGHIJ");

    expect(embeddingsMock).toHaveBeenCalledTimes(2);
    expect(vector).toEqual([2, 2, 2]);
  });

  it("applies fallback for single-chunk context overflow and recovers by splitting", async () => {
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "2000";
    embeddingsMock
      .mockRejectedValueOnce(
        new Error("the input length exceeds the context length")
      )
      .mockResolvedValueOnce({ embedding: [1, 1, 1] })
      .mockResolvedValueOnce({ embedding: [3, 3, 3] });
    const { embed } = await import("../embeddings");

    const vector = await embed("x".repeat(1000));

    expect(embeddingsMock).toHaveBeenCalledTimes(3);
    expect(vector).toEqual([2, 2, 2]);
  });

  it("throws deterministic embedding_input_too_large when chunk embedding fails", async () => {
    embeddingsMock.mockRejectedValue(
      new Error("the input length exceeds the context length")
    );
    const { embed } = await import("../embeddings");

    await expect(embed("abcdefghijABCDEFGHIJ")).rejects.toMatchObject({
      code: "embedding_input_too_large",
    });
  });

  it("throws deterministic embedding_input_too_large when single-chunk fallback cannot recover", async () => {
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "2000";
    embeddingsMock.mockRejectedValue(
      new Error("the input length exceeds the context length")
    );
    const { embed } = await import("../embeddings");

    await expect(embed("x".repeat(1000))).rejects.toMatchObject({
      code: "embedding_input_too_large",
    });
  });

  it("detects context overflow from ResponseError-shaped nested fields and retries fallback", async () => {
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "2000";
    embeddingsMock
      .mockRejectedValueOnce({
        name: "ResponseError",
        response: {
          statusText: "Bad Request",
          body: {
            error: "the input length exceeds the context length",
          },
        },
      })
      .mockResolvedValueOnce({ embedding: [2, 2, 2] })
      .mockResolvedValueOnce({ embedding: [4, 4, 4] });
    const { embed } = await import("../embeddings");

    const vector = await embed("x".repeat(1000));

    expect(embeddingsMock).toHaveBeenCalledTimes(3);
    expect(vector).toEqual([3, 3, 3]);
  });

  it("returns deterministic error for ResponseError-shaped context overflow when fallback cannot recover", async () => {
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "2000";
    embeddingsMock.mockRejectedValue({
      name: "ResponseError",
      response: {
        statusText: "Bad Request",
        body: {
          error: "the input length exceeds the context length",
        },
      },
    });
    const { embed } = await import("../embeddings");

    await expect(embed("x".repeat(1000))).rejects.toMatchObject({
      code: "embedding_input_too_large",
    });
  });

  it("does not retry non-context embedding errors", async () => {
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "2000";
    embeddingsMock.mockRejectedValue(new Error("connection refused"));
    const { embed } = await import("../embeddings");

    await expect(embed("x".repeat(1000))).rejects.toMatchObject({
      code: "embedding_input_too_large",
    });
    expect(embeddingsMock).toHaveBeenCalledTimes(1);
  });

  it("uses bounded chunk concurrency and preserves deterministic pooled output", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    embeddingsMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) =>
        setTimeout(resolve, prompt.startsWith("A") ? 15 : 5)
      );
      inFlight -= 1;
      if (prompt.startsWith("A")) return { embedding: [1, 1, 1] };
      if (prompt.startsWith("B")) return { embedding: [3, 3, 3] };
      return { embedding: [5, 5, 5] };
    });
    const { embed } = await import("../embeddings");

    const vector = await embed("AAAAAAAAAABBBBBBBBBBCCCCCCCCCC");

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(vector).toEqual([3, 3, 3]);
  });

  it("passes preflight when configured model exists", async () => {
    listMock.mockResolvedValue({
      models: [{ name: "nomic-embed-text:latest" }],
    });
    const { ensureEmbeddingModelAvailable } = await import("../embeddings");

    await expect(ensureEmbeddingModelAvailable()).resolves.toBeUndefined();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("fails preflight when configured model is missing", async () => {
    listMock.mockResolvedValue({
      models: [{ name: "mxbai-embed-large:latest" }],
    });
    const { ensureEmbeddingModelAvailable } = await import("../embeddings");

    await expect(ensureEmbeddingModelAvailable()).rejects.toMatchObject({
      code: "embedding_model_missing",
    });
  });

  it("does not lock embedding model at module-load time", async () => {
    const module = await import("../embeddings");
    const { ensureEmbeddingModelAvailable, resetEmbeddingPreflightForTests } = module;

    await ensureEmbeddingModelAvailable();
    expect(listMock).toHaveBeenCalledTimes(1);

    resetEmbeddingPreflightForTests();
    process.env.EMBEDDING_MODEL = "mxbai-embed-large";
    process.env.MEMORYMESH_EMBEDDING_MODE = "medium";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "1024";
    listMock.mockResolvedValue({
      models: [{ name: "mxbai-embed-large:latest" }],
    });

    await ensureEmbeddingModelAvailable();
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
