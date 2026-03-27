import {
  getInstallerRuntimeEnvPath,
  mapEmbeddingModeToDimension,
  mapEmbeddingModeToModel,
  mapEmbeddingModelToDimension,
  parseRuntimeEnv,
  resolveInstallerEmbeddingConfig,
  writeInstallerRuntimeEnv,
} from "../installer/runtime-config";
import { IFileSystem } from "../system/filesystem";

describe("runtime env config", () => {
  it("maps embedding mode to model", () => {
    expect(mapEmbeddingModeToModel("flash")).toBe("nomic-embed-text");
    expect(mapEmbeddingModeToModel("medium")).toBe("mxbai-embed-large");
    expect(mapEmbeddingModeToDimension("flash")).toBe(768);
    expect(mapEmbeddingModeToDimension("medium")).toBe(1024);
    expect(mapEmbeddingModelToDimension("nomic-embed-text")).toBe(768);
    expect(mapEmbeddingModelToDimension("mxbai-embed-large")).toBe(1024);
  });

  it("parses runtime env file", () => {
    const env = parseRuntimeEnv(
      "# Managed\nMEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n"
    );
    expect(env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("writes installer runtime env", async () => {
    let written = "";
    const fs: IFileSystem = {
      exists: () => false,
      mkdir: async () => {},
      read: async () => "",
      write: async (_path, content) => {
        written = content;
      },
    };

    await writeInstallerRuntimeEnv(
      "/tmp/home",
      {
        embeddingMode: "medium",
        embeddingModel: "mxbai-embed-large",
        embeddingDimension: 1024,
      },
      fs
    );

    expect(written).toContain("MEMORYMESH_EMBEDDING_MODE=medium");
    expect(written).toContain("EMBEDDING_MODEL=mxbai-embed-large");
    expect(written).toContain("MEMORYMESH_EMBEDDING_DIMENSION=1024");
  });

  it("resolves runtime env path with Windows separators", () => {
    expect(getInstallerRuntimeEnvPath("C:\\Users\\Test")).toBe(
      "C:\\Users\\Test\\.memorymesh\\runtime.env"
    );
  });

  it("resolves installer embedding config from runtime env", () => {
    const resolved = resolveInstallerEmbeddingConfig({
      EMBEDDING_MODEL: "mxbai-embed-large",
      MEMORYMESH_EMBEDDING_MODE: "medium",
      MEMORYMESH_EMBEDDING_DIMENSION: "1024",
    });

    expect(resolved).toEqual({
      embeddingMode: "medium",
      embeddingModel: "mxbai-embed-large",
      embeddingDimension: 1024,
    });
  });
});
