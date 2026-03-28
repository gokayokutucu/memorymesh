import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import {
  getInstallerRuntimeEnvPath,
  readInstallerRuntimeEnv,
} from "./runtime-config";

export type RuntimeEnvironmentMode = "local-dev" | "installed-cli" | "hosted-cloud";

export interface IRuntimeEnvironmentContext {
  mode: RuntimeEnvironmentMode;
  isCloud: boolean;
  usesExternalSecrets: boolean;
  semanticAuthorityOrder: readonly ["session", "config", "runtime_env", "live_detection"];
  runtimeEnvEnabled: boolean;
}

export interface IResolvedRuntimeEnvironmentContext {
  context: IRuntimeEnvironmentContext;
  runtimeEnvPath: string;
  runtimeEnvLoaded: boolean;
}

interface IRuntimeEnvironmentBootstrapInput {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  fs?: IFileSystem;
}

const EXTERNAL_SECRET_KEYS = [
  "MONGO_USER",
  "MONGO_PASSWORD",
  "NEO4J_USER",
  "NEO4J_PASSWORD",
  "QDRANT_API_KEY",
] as const;

const CLOUD_SIGNAL_KEYS = [
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "K_SERVICE",
  "RENDER",
  "FLY_APP_NAME",
  "MEMORYMESH_HOSTED",
] as const;

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isTrueFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function mergeRuntimeEnvironment(
  context: IRuntimeEnvironmentContext,
  runtimeEnv: NodeJS.ProcessEnv,
  processEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  if (context.mode === "hosted-cloud") {
    return { ...runtimeEnv, ...processEnv };
  }

  const merged: NodeJS.ProcessEnv = { ...runtimeEnv };
  for (const key of EXTERNAL_SECRET_KEYS) {
    if (hasValue(processEnv[key])) {
      merged[key] = processEnv[key];
    }
  }
  if (hasValue(processEnv.MEMORYMESH_USE_LOCAL_BUILD)) {
    merged.MEMORYMESH_USE_LOCAL_BUILD = processEnv.MEMORYMESH_USE_LOCAL_BUILD;
  }
  return merged;
}

export function resolveRuntimeEnvironmentContext(
  env: NodeJS.ProcessEnv = process.env
): IRuntimeEnvironmentContext {
  const localDev = isTrueFlag(env.MEMORYMESH_USE_LOCAL_BUILD);
  const usesExternalSecrets = EXTERNAL_SECRET_KEYS.some((key) => hasValue(env[key]));
  const hasCloudSignal = CLOUD_SIGNAL_KEYS.some((key) => hasValue(env[key]));
  const hostedCloud = !localDev && (hasCloudSignal || usesExternalSecrets);

  const mode: RuntimeEnvironmentMode = localDev
    ? "local-dev"
    : hostedCloud
      ? "hosted-cloud"
      : "installed-cli";

  return {
    mode,
    isCloud: mode === "hosted-cloud",
    usesExternalSecrets,
    semanticAuthorityOrder: ["session", "config", "runtime_env", "live_detection"],
    runtimeEnvEnabled: true,
  };
}

export async function applyRuntimeEnvironmentBootstrap(
  input: IRuntimeEnvironmentBootstrapInput
): Promise<IResolvedRuntimeEnvironmentContext> {
  const env = input.env ?? process.env;
  const fs = input.fs ?? nodeFileSystem;
  const context = resolveRuntimeEnvironmentContext(env);
  const runtimeEnvPath = getInstallerRuntimeEnvPath(input.homeDir);
  const runtimeEnv = context.runtimeEnvEnabled
    ? await readInstallerRuntimeEnv(input.homeDir, fs)
    : {};
  const merged = mergeRuntimeEnvironment(context, runtimeEnv, env);

  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "undefined") {
      env[key] = value;
    }
  }

  return {
    context,
    runtimeEnvPath,
    runtimeEnvLoaded: Object.keys(runtimeEnv).length > 0,
  };
}
