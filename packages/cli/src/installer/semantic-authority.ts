import { IInstallConfig, readInstallConfig } from "./first-run";
import { detectQdrantCollectionDimension } from "./qdrant-dimension";
import {
  mapEmbeddingModeToDimension,
  resolveInstallerEmbeddingConfig,
  readInstallerRuntimeEnv,
} from "./runtime-config";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { ICommandRunner } from "../system/command-runner";

export interface ISemanticEmbeddingAuthority {
  embeddingMode: "flash" | "medium";
  embeddingModel: "nomic-embed-text" | "mxbai-embed-large";
  embeddingDimension: number;
}

export interface IResolvedSemanticEmbeddingAuthority {
  embedding: ISemanticEmbeddingAuthority;
  source: "session" | "config" | "runtime_env" | "live_detection";
  installConfig?: IInstallConfig;
}

export interface IResolveSemanticEmbeddingAuthorityOptions {
  homeDir: string;
  fs?: IFileSystem;
  runner?: ICommandRunner;
  collectionName?: string;
  preferSession?: boolean;
}

let sessionEmbeddingAuthority: ISemanticEmbeddingAuthority | null = null;

function fromInstallConfig(config: IInstallConfig): ISemanticEmbeddingAuthority {
  return {
    embeddingMode: config.embeddingMode,
    embeddingModel:
      config.embeddingModel === "nomic-embed-text" ? "nomic-embed-text" : "mxbai-embed-large",
    embeddingDimension: mapEmbeddingModeToDimension(config.embeddingMode),
  };
}

function fromRuntimeEnv(runtimeEnv: NodeJS.ProcessEnv): ISemanticEmbeddingAuthority | null {
  try {
    const resolved = resolveInstallerEmbeddingConfig(runtimeEnv);
    return {
      embeddingMode: resolved.embeddingMode,
      embeddingModel: resolved.embeddingModel,
      embeddingDimension: resolved.embeddingDimension,
    };
  } catch {
    return null;
  }
}

function fromDetectedDimension(dimension: number | null): ISemanticEmbeddingAuthority | null {
  if (dimension === 768) {
    return {
      embeddingMode: "flash",
      embeddingModel: "nomic-embed-text",
      embeddingDimension: 768,
    };
  }
  if (dimension === 1024) {
    return {
      embeddingMode: "medium",
      embeddingModel: "mxbai-embed-large",
      embeddingDimension: 1024,
    };
  }
  return null;
}

export function setSessionSemanticEmbeddingAuthority(
  embedding: ISemanticEmbeddingAuthority
): void {
  sessionEmbeddingAuthority = {
    embeddingMode: embedding.embeddingMode,
    embeddingModel: embedding.embeddingModel,
    embeddingDimension: embedding.embeddingDimension,
  };
}

export function clearSessionSemanticEmbeddingAuthority(): void {
  sessionEmbeddingAuthority = null;
}

export function getSessionSemanticEmbeddingAuthority(): ISemanticEmbeddingAuthority | null {
  if (!sessionEmbeddingAuthority) {
    return null;
  }
  return {
    embeddingMode: sessionEmbeddingAuthority.embeddingMode,
    embeddingModel: sessionEmbeddingAuthority.embeddingModel,
    embeddingDimension: sessionEmbeddingAuthority.embeddingDimension,
  };
}

export async function resolveSemanticEmbeddingAuthority(
  options: IResolveSemanticEmbeddingAuthorityOptions
): Promise<IResolvedSemanticEmbeddingAuthority | null> {
  const fs = options.fs ?? nodeFileSystem;
  const preferSession = options.preferSession ?? true;
  if (preferSession && sessionEmbeddingAuthority) {
    return {
      embedding: getSessionSemanticEmbeddingAuthority() as ISemanticEmbeddingAuthority,
      source: "session",
    };
  }

  const config = await readInstallConfig(options.homeDir, fs);
  if (config) {
    return {
      embedding: fromInstallConfig(config),
      source: "config",
      installConfig: config,
    };
  }

  const runtimeEnv = await readInstallerRuntimeEnv(options.homeDir, fs);
  const runtimeEmbedding = fromRuntimeEnv(runtimeEnv);
  if (runtimeEmbedding) {
    return {
      embedding: runtimeEmbedding,
      source: "runtime_env",
    };
  }

  if (options.runner) {
    const dimension = await detectQdrantCollectionDimension(
      options.runner,
      options.collectionName ?? "memories"
    );
    const detected = fromDetectedDimension(dimension);
    if (detected) {
      return {
        embedding: detected,
        source: "live_detection",
      };
    }
  }

  return null;
}
