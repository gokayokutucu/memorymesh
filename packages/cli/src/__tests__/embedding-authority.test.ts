import { resolveAuthoritativeEmbeddingConfig } from "../installer/embedding-authority";
import { IFileSystem } from "../system/filesystem";

function createFs(files: Record<string, string>): IFileSystem {
  return {
    exists: (path: string) => Object.prototype.hasOwnProperty.call(files, path),
    mkdir: async () => {},
    read: async (path: string) => files[path] ?? "",
    write: async (path: string, content: string) => {
      files[path] = content;
    },
  };
}

function installConfig(
  mode: "flash" | "medium",
  model: "nomic-embed-text" | "mxbai-embed-large",
  dimension: number
): string {
  return JSON.stringify(
    {
      installState: "installed",
      embeddingMode: mode,
      embeddingModel: model,
      embeddingDimension: dimension,
      installedAt: "2026-03-24T00:00:00.000Z",
      stackProjectDir: "/tmp/home/.memorymesh/stack",
      composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
      stackMode: "release-image",
    },
    null,
    2
  );
}

describe("embedding authority", () => {
  it("resolves authoritative embedding config from config.json", async () => {
    const fs = createFs({
      "/tmp/home/.memorymesh/config.json": installConfig(
        "medium",
        "mxbai-embed-large",
        1024
      ),
      "/tmp/home/.memorymesh/runtime.env":
        "MEMORYMESH_EMBEDDING_MODE=medium\nEMBEDDING_MODEL=mxbai-embed-large\nMEMORYMESH_EMBEDDING_DIMENSION=1024\n",
    });

    const resolved = await resolveAuthoritativeEmbeddingConfig("/tmp/home", fs);
    expect(resolved.embedding).toEqual({
      embeddingMode: "medium",
      embeddingModel: "mxbai-embed-large",
      embeddingDimension: 1024,
    });
    expect(resolved.runtimeEnvRegenerated).toBe(false);
  });

  it("regenerates runtime.env from config.json when drift exists", async () => {
    const files: Record<string, string> = {
      "/tmp/home/.memorymesh/config.json": installConfig(
        "medium",
        "mxbai-embed-large",
        1024
      ),
      "/tmp/home/.memorymesh/runtime.env":
        "MEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n",
    };
    const fs = createFs(files);

    const resolved = await resolveAuthoritativeEmbeddingConfig("/tmp/home", fs);
    expect(resolved.runtimeEnvRegenerated).toBe(true);
    expect(files["/tmp/home/.memorymesh/runtime.env"]).toContain(
      "MEMORYMESH_EMBEDDING_MODE=medium"
    );
    expect(files["/tmp/home/.memorymesh/runtime.env"]).toContain(
      "EMBEDDING_MODEL=mxbai-embed-large"
    );
    expect(files["/tmp/home/.memorymesh/runtime.env"]).toContain(
      "MEMORYMESH_EMBEDDING_DIMENSION=1024"
    );
  });
});
