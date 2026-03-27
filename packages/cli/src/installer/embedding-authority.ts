import { IInstallConfig, readInstallConfig } from "./first-run";
import {
  IResolvedInstallerEmbeddingConfig,
  parseRuntimeEnv,
  writeInstallerRuntimeEnv,
  getInstallerRuntimeEnvPath,
} from "./runtime-config";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";

function toResolvedEmbedding(config: IInstallConfig): IResolvedInstallerEmbeddingConfig {
  return {
    embeddingMode: config.embeddingMode,
    embeddingModel:
      config.embeddingModel === "nomic-embed-text" ? "nomic-embed-text" : "mxbai-embed-large",
    embeddingDimension: config.embeddingDimension,
  };
}

function createRuntimeEnvFromResolved(
  resolved: IResolvedInstallerEmbeddingConfig
): NodeJS.ProcessEnv {
  return {
    EMBEDDING_MODEL: resolved.embeddingModel,
    MEMORYMESH_EMBEDDING_MODE: resolved.embeddingMode,
    MEMORYMESH_EMBEDDING_DIMENSION: String(resolved.embeddingDimension),
  };
}

function hasRuntimeEnvDrift(
  runtimeEnv: NodeJS.ProcessEnv,
  expected: NodeJS.ProcessEnv
): boolean {
  return (
    runtimeEnv.EMBEDDING_MODEL?.trim() !== expected.EMBEDDING_MODEL
    || runtimeEnv.MEMORYMESH_EMBEDDING_MODE?.trim() !== expected.MEMORYMESH_EMBEDDING_MODE
    || runtimeEnv.MEMORYMESH_EMBEDDING_DIMENSION?.trim()
      !== expected.MEMORYMESH_EMBEDDING_DIMENSION
  );
}

export interface IResolvedAuthority {
  config: IInstallConfig;
  embedding: IResolvedInstallerEmbeddingConfig;
  runtimeEnv: NodeJS.ProcessEnv;
  runtimeEnvPath: string;
  runtimeEnvRegenerated: boolean;
}

export async function resolveAuthoritativeEmbeddingConfig(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem
): Promise<IResolvedAuthority> {
  const config = await readInstallConfig(homeDir, fs);
  if (!config) {
    throw new Error(
      "MemoryMesh install config is missing or invalid. Run setup to create ~/.memorymesh/config.json."
    );
  }

  const embedding = toResolvedEmbedding(config);
  const expectedRuntimeEnv = createRuntimeEnvFromResolved(embedding);
  const runtimeEnvPath = getInstallerRuntimeEnvPath(homeDir);
  let runtimeEnvRegenerated = false;
  let currentRuntimeEnv: NodeJS.ProcessEnv = {};

  if (fs.exists(runtimeEnvPath)) {
    currentRuntimeEnv = parseRuntimeEnv(await fs.read(runtimeEnvPath));
  }

  if (!fs.exists(runtimeEnvPath) || hasRuntimeEnvDrift(currentRuntimeEnv, expectedRuntimeEnv)) {
    await writeInstallerRuntimeEnv(
      homeDir,
      {
        embeddingMode: embedding.embeddingMode,
        embeddingModel: embedding.embeddingModel,
        embeddingDimension: embedding.embeddingDimension,
      },
      fs
    );
    runtimeEnvRegenerated = true;
    currentRuntimeEnv = expectedRuntimeEnv;
  }

  return {
    config,
    embedding,
    runtimeEnv: expectedRuntimeEnv,
    runtimeEnvPath,
    runtimeEnvRegenerated,
  };
}
