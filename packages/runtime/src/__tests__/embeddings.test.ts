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

  it("throws deterministic embedding_input_too_large when chunk embedding fails", async () => {
    embeddingsMock.mockRejectedValue(
      new Error("the input length exceeds the context length")
    );
    const { embed } = await import("../embeddings");

    await expect(embed("abcdefghijABCDEFGHIJ")).rejects.toMatchObject({
      code: "embedding_input_too_large",
    });
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
});
