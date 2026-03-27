import { resolveEmbeddingConfig } from "../embedding-config";

describe("embedding-config", () => {
  it("resolves flash model and dimension", () => {
    const config = resolveEmbeddingConfig({
      EMBEDDING_MODEL: "nomic-embed-text",
      MEMORYMESH_EMBEDDING_MODE: "flash",
      MEMORYMESH_EMBEDDING_DIMENSION: "768",
    });

    expect(config).toEqual({
      embeddingMode: "flash",
      embeddingModel: "nomic-embed-text",
      embeddingDimension: 768,
    });
  });

  it("resolves medium model and dimension", () => {
    const config = resolveEmbeddingConfig({
      EMBEDDING_MODEL: "mxbai-embed-large",
      MEMORYMESH_EMBEDDING_MODE: "medium",
      MEMORYMESH_EMBEDDING_DIMENSION: "1024",
    });

    expect(config).toEqual({
      embeddingMode: "medium",
      embeddingModel: "mxbai-embed-large",
      embeddingDimension: 1024,
    });
  });

  it("fails when model and dimension drift", () => {
    expect(() =>
      resolveEmbeddingConfig({
        EMBEDDING_MODEL: "mxbai-embed-large",
        MEMORYMESH_EMBEDDING_MODE: "medium",
        MEMORYMESH_EMBEDDING_DIMENSION: "768",
      })
    ).toThrow("Embedding configuration mismatch");
  });
});
