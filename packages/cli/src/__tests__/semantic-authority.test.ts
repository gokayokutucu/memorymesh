import {
  clearSessionSemanticEmbeddingAuthority,
  resolveSemanticEmbeddingAuthority,
  setSessionSemanticEmbeddingAuthority,
} from "../installer/semantic-authority";
import { IFileSystem } from "../system/filesystem";
import { ICommandRunner } from "../system/command-runner";

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

describe("semantic authority", () => {
  afterEach(() => {
    clearSessionSemanticEmbeddingAuthority();
  });

  it("prefers config.json over runtime.env for semantic reads", async () => {
    const fs = createFs({
      "/tmp/home/.memorymesh/config.json": installConfig(
        "medium",
        "mxbai-embed-large",
        1024
      ),
      "/tmp/home/.memorymesh/runtime.env":
        "MEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n",
    });

    const resolved = await resolveSemanticEmbeddingAuthority({
      homeDir: "/tmp/home",
      fs,
    });
    expect(resolved?.source).toBe("config");
    expect(resolved?.embedding.embeddingMode).toBe("medium");
    expect(resolved?.embedding.embeddingDimension).toBe(1024);
  });

  it("prefers same-process session authority over persisted fallback", async () => {
    setSessionSemanticEmbeddingAuthority({
      embeddingMode: "medium",
      embeddingModel: "mxbai-embed-large",
      embeddingDimension: 1024,
    });
    const fs = createFs({
      "/tmp/home/.memorymesh/config.json": installConfig(
        "flash",
        "nomic-embed-text",
        768
      ),
    });

    const resolved = await resolveSemanticEmbeddingAuthority({
      homeDir: "/tmp/home",
      fs,
    });
    expect(resolved?.source).toBe("session");
    expect(resolved?.embedding.embeddingMode).toBe("medium");
  });

  it("falls back safely when config.json is missing", async () => {
    const fs = createFs({
      "/tmp/home/.memorymesh/runtime.env":
        "MEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n",
    });

    const resolvedFromRuntimeEnv = await resolveSemanticEmbeddingAuthority({
      homeDir: "/tmp/home",
      fs,
    });
    expect(resolvedFromRuntimeEnv?.source).toBe("runtime_env");
    expect(resolvedFromRuntimeEnv?.embedding.embeddingDimension).toBe(768);

    const runner: ICommandRunner = {
      async run() {
        return {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({ result: { config: { params: { vectors: { size: 1024 } } } } }),
          stderr: "",
        };
      },
    };
    const emptyFs = createFs({});
    const resolvedFromDetection = await resolveSemanticEmbeddingAuthority({
      homeDir: "/tmp/home",
      fs: emptyFs,
      runner,
      collectionName: "memories",
    });
    expect(resolvedFromDetection?.source).toBe("live_detection");
    expect(resolvedFromDetection?.embedding.embeddingMode).toBe("medium");
  });
});
