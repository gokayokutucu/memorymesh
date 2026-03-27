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

function pickServiceAuthEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = ["MONGO_USER", "MONGO_PASSWORD", "NEO4J_USER", "NEO4J_PASSWORD"] as const;
  const picked: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      picked[key] = value.trim();
    }
  }
  return picked;
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
  const runtimeEnvPath = getInstallerRuntimeEnvPath(homeDir);
  let runtimeEnvRegenerated = false;
  let currentRuntimeEnv: NodeJS.ProcessEnv = {};

  if (fs.exists(runtimeEnvPath)) {
    currentRuntimeEnv = parseRuntimeEnv(await fs.read(runtimeEnvPath));
  }
  const expectedRuntimeEnv = {
    ...createRuntimeEnvFromResolved(embedding),
    ...pickServiceAuthEnv(currentRuntimeEnv),
  };

  if (!fs.exists(runtimeEnvPath) || hasRuntimeEnvDrift(currentRuntimeEnv, expectedRuntimeEnv)) {
    const serviceAuthEnv = pickServiceAuthEnv(currentRuntimeEnv);
    await writeInstallerRuntimeEnv(
      homeDir,
      {
        embeddingMode: embedding.embeddingMode,
        embeddingModel: embedding.embeddingModel,
        embeddingDimension: embedding.embeddingDimension,
        mongoUser: serviceAuthEnv.MONGO_USER,
        mongoPassword: serviceAuthEnv.MONGO_PASSWORD,
        neo4jUser: serviceAuthEnv.NEO4J_USER,
        neo4jPassword: serviceAuthEnv.NEO4J_PASSWORD,
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
