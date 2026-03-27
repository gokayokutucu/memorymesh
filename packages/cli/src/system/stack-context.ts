import { dirname, isAbsolute, join, resolve } from "node:path";
import path from "node:path";
import { IFileSystem, nodeFileSystem } from "./filesystem";
import { joinFromHome, resolveUserHomeDir } from "./runtime-home";
import { resolveInstallerManagedStack } from "../installer/stack-packaging";

export interface IStackContext {
  projectDir: string;
  composeFilePath: string;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function dirnameForPath(filePath: string): string {
  if (path.win32.isAbsolute(filePath)) {
    return path.win32.dirname(filePath);
  }

  return dirname(filePath);
}

function fileExists(fs: IFileSystem, path: string): boolean {
  return fs.exists(path);
}

function resolveComposePath(baseDir: string, composeValue: string): string {
  if (isAbsolute(composeValue) || path.win32.isAbsolute(composeValue)) {
    return composeValue;
  }

  return resolve(baseDir, composeValue);
}

function resolveStackPath(baseDir: string, stackDir: string): string {
  if (isAbsolute(stackDir) || path.win32.isAbsolute(stackDir)) {
    return stackDir;
  }

  return resolve(baseDir, stackDir);
}

function findUpwardComposeFile(startDir: string, fs: IFileSystem): string | null {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, "docker-compose.yml");
    if (fileExists(fs, candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function resolveStackContext(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  fs: IFileSystem = nodeFileSystem,
  homeDir: string = resolveUserHomeDir(process.platform, env)
): IStackContext {
  const localBuildToggle = parseBooleanEnv(env.MEMORYMESH_USE_LOCAL_BUILD);
  if (localBuildToggle === true) {
    const composeFilePath = findUpwardComposeFile(cwd, fs);
    if (!composeFilePath) {
      throw new Error(
        "MEMORYMESH_USE_LOCAL_BUILD=true requires docker-compose.yml in current directory or a parent directory."
      );
    }
    return {
      projectDir: dirname(composeFilePath),
      composeFilePath,
    };
  }

  const installerManaged = resolveInstallerManagedStack(homeDir, fs);
  if (installerManaged) {
    return installerManaged;
  }

  const explicitStackDir = env.MEMORYMESH_STACK_DIR;
  const explicitComposeFile = env.MEMORYMESH_COMPOSE_FILE;

  if (explicitComposeFile) {
    const composeFilePath = resolveComposePath(cwd, explicitComposeFile);
    if (!fileExists(fs, composeFilePath)) {
      throw new Error(`MEMORYMESH_COMPOSE_FILE not found: ${composeFilePath}`);
    }

    return {
      projectDir: explicitStackDir
        ? resolveStackPath(cwd, explicitStackDir)
        : dirnameForPath(composeFilePath),
      composeFilePath,
    };
  }

  if (explicitStackDir) {
    const projectDir = resolveStackPath(cwd, explicitStackDir);
    const composeFilePath = joinFromHome(projectDir, "docker-compose.yml");
    if (!fileExists(fs, composeFilePath)) {
      throw new Error(`docker-compose.yml not found in MEMORYMESH_STACK_DIR: ${projectDir}`);
    }

    return {
      projectDir,
      composeFilePath,
    };
  }

  const discoveredCompose = findUpwardComposeFile(cwd, fs);
  if (!discoveredCompose) {
    throw new Error(
      "Unable to resolve stack definition. Installer-managed stack not found and no compose path hints were provided."
    );
  }

  return {
    projectDir: dirname(discoveredCompose),
    composeFilePath: discoveredCompose,
  };
}
