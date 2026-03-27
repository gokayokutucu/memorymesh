import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { joinFromHome } from "../system/runtime-home";
import { mapEmbeddingModelToDimension } from "./runtime-config";

export interface IInstallConfig {
  installState: "installed";
  embeddingMode: "flash" | "medium";
  embeddingModel: string;
  embeddingDimension: number;
  installedAt: string;
  stackProjectDir: string;
  composeFilePath: string;
  stackMode?: "release-image" | "local-dev-build";
}

export function getMemoryMeshConfigPath(homeDir: string): string {
  return joinFromHome(homeDir, ".memorymesh", "config.json");
}

export function isMemoryMeshInstalled(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem
): boolean {
  return fs.exists(getMemoryMeshConfigPath(homeDir));
}

export async function persistInstallConfig(
  homeDir: string,
  config: IInstallConfig,
  fs: IFileSystem = nodeFileSystem
): Promise<void> {
  const configDir = joinFromHome(homeDir, ".memorymesh");
  await fs.mkdir(configDir);
  await fs.write(getMemoryMeshConfigPath(homeDir), `${JSON.stringify(config, null, 2)}\n`);
}

export async function readInstallConfig(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem
): Promise<IInstallConfig | null> {
  const configPath = getMemoryMeshConfigPath(homeDir);
  if (!fs.exists(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(await fs.read(configPath)) as Partial<IInstallConfig>;
    if (
      parsed.installState !== "installed" ||
      (parsed.embeddingMode !== "flash" && parsed.embeddingMode !== "medium") ||
      typeof parsed.embeddingModel !== "string" ||
      (parsed.embeddingDimension !== undefined &&
        typeof parsed.embeddingDimension !== "number") ||
      typeof parsed.installedAt !== "string" ||
      typeof parsed.stackProjectDir !== "string" ||
      typeof parsed.composeFilePath !== "string" ||
      (parsed.stackMode !== undefined &&
        parsed.stackMode !== "release-image" &&
        parsed.stackMode !== "local-dev-build")
    ) {
      return null;
    }

    const embeddingDimension =
      typeof parsed.embeddingDimension === "number"
        ? parsed.embeddingDimension
        : mapEmbeddingModelToDimension(parsed.embeddingModel);
    if (!embeddingDimension) {
      return null;
    }

    const expectedDimension = mapEmbeddingModelToDimension(parsed.embeddingModel);
    if (!expectedDimension || expectedDimension !== embeddingDimension) {
      return null;
    }

    return {
      installState: "installed",
      embeddingMode: parsed.embeddingMode,
      embeddingModel: parsed.embeddingModel,
      embeddingDimension,
      installedAt: parsed.installedAt,
      stackProjectDir: parsed.stackProjectDir,
      composeFilePath: parsed.composeFilePath,
      stackMode: parsed.stackMode ?? "release-image",
    };
  } catch {
    return null;
  }
}
