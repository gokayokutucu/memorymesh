import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { joinFromHome } from "../system/runtime-home";

export interface IRuntimeEnvConfig {
  embeddingMode: "flash" | "medium";
  embeddingModel: string;
  embeddingDimension: number;
}

export interface IResolvedInstallerEmbeddingConfig {
  embeddingMode: "flash" | "medium";
  embeddingModel: "nomic-embed-text" | "mxbai-embed-large";
  embeddingDimension: number;
}

export function getMemoryMeshConfigDir(homeDir: string): string {
  return joinFromHome(homeDir, ".memorymesh");
}

export function getInstallerRuntimeEnvPath(homeDir: string): string {
  return joinFromHome(getMemoryMeshConfigDir(homeDir), "runtime.env");
}

export function mapEmbeddingModeToModel(
  mode: "flash" | "medium"
): "nomic-embed-text" | "mxbai-embed-large" {
  if (mode === "flash") {
    return "nomic-embed-text";
  }

  return "mxbai-embed-large";
}

export function mapEmbeddingModeToDimension(
  mode: "flash" | "medium"
): number {
  if (mode === "flash") {
    return 768;
  }

  return 1024;
}

export function mapEmbeddingModelToDimension(model: string): number | null {
  if (model === "nomic-embed-text") {
    return 768;
  }

  if (model === "mxbai-embed-large") {
    return 1024;
  }

  return null;
}

export function resolveInstallerEmbeddingConfig(
  env: NodeJS.ProcessEnv
): IResolvedInstallerEmbeddingConfig {
  const embeddingModelRaw = env.EMBEDDING_MODEL?.trim();
  const embeddingModeRaw = env.MEMORYMESH_EMBEDDING_MODE?.trim();
  const embeddingDimensionRaw = env.MEMORYMESH_EMBEDDING_DIMENSION?.trim();

  if (embeddingModelRaw !== "nomic-embed-text" && embeddingModelRaw !== "mxbai-embed-large") {
    throw new Error(
      `Invalid installer embedding model in runtime.env: ${embeddingModelRaw ?? "missing"}`
    );
  }

  if (embeddingModeRaw !== "flash" && embeddingModeRaw !== "medium") {
    throw new Error(
      `Invalid installer embedding mode in runtime.env: ${embeddingModeRaw ?? "missing"}`
    );
  }

  const parsedDimension = Number.parseInt(embeddingDimensionRaw ?? "", 10);
  if (!Number.isFinite(parsedDimension)) {
    throw new Error(
      `Invalid installer embedding dimension in runtime.env: ${embeddingDimensionRaw ?? "missing"}`
    );
  }

  const expectedModel = mapEmbeddingModeToModel(embeddingModeRaw);
  if (expectedModel !== embeddingModelRaw) {
    throw new Error(
      `Installer embedding mismatch: mode=${embeddingModeRaw} requires model=${expectedModel}, got=${embeddingModelRaw}.`
    );
  }

  const expectedDimension = mapEmbeddingModelToDimension(embeddingModelRaw);
  if (!expectedDimension || expectedDimension !== parsedDimension) {
    throw new Error(
      `Installer embedding mismatch: model=${embeddingModelRaw} requires dimension=${expectedDimension ?? "unknown"}, got=${parsedDimension}.`
    );
  }

  return {
    embeddingMode: embeddingModeRaw,
    embeddingModel: embeddingModelRaw,
    embeddingDimension: parsedDimension,
  };
}

export function parseRuntimeEnv(content: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

export async function writeInstallerRuntimeEnv(
  homeDir: string,
  config: IRuntimeEnvConfig,
  fs: IFileSystem = nodeFileSystem
): Promise<string> {
  const configDir = getMemoryMeshConfigDir(homeDir);
  const envPath = getInstallerRuntimeEnvPath(homeDir);
  await fs.mkdir(configDir);

  const content = [
    "# Managed by MemoryMesh installer",
    `MEMORYMESH_EMBEDDING_MODE=${config.embeddingMode}`,
    `EMBEDDING_MODEL=${config.embeddingModel}`,
    `MEMORYMESH_EMBEDDING_DIMENSION=${String(config.embeddingDimension)}`,
    "",
  ].join("\n");

  await fs.write(envPath, content);
  return envPath;
}

export async function readInstallerRuntimeEnv(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem
): Promise<NodeJS.ProcessEnv> {
  const envPath = getInstallerRuntimeEnvPath(homeDir);
  if (!fs.exists(envPath)) {
    return {};
  }

  return parseRuntimeEnv(await fs.read(envPath));
}
