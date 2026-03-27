import { homedir } from "node:os";
import path from "node:path";

function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");
}

function getPathModuleForHome(homeDir: string): typeof path.posix | typeof path.win32 {
  return isWindowsStylePath(homeDir) ? path.win32 : path.posix;
}

export function joinFromHome(homeDir: string, ...segments: string[]): string {
  return getPathModuleForHome(homeDir).join(homeDir, ...segments);
}

export function resolveUserHomeDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  osHomeDir: string = homedir()
): string {
  const explicitMemoryMeshHome = env.MEMORYMESH_HOME?.trim();
  if (explicitMemoryMeshHome) {
    const pathImpl = isWindowsStylePath(explicitMemoryMeshHome) ? path.win32 : path.posix;
    return pathImpl.resolve(explicitMemoryMeshHome);
  }

  if (platform === "win32") {
    const userProfile = env.USERPROFILE?.trim();
    if (userProfile) {
      return path.win32.resolve(userProfile);
    }

    const homeDrive = env.HOMEDRIVE?.trim();
    const homePath = env.HOMEPATH?.trim();
    if (homeDrive && homePath) {
      return path.win32.resolve(`${homeDrive}${homePath}`);
    }

    const home = env.HOME?.trim();
    if (home) {
      return path.win32.resolve(home);
    }

    if (osHomeDir?.trim()) {
      return path.win32.resolve(osHomeDir);
    }

    throw new Error(
      "Unable to resolve user home directory on Windows. Set USERPROFILE, HOMEDRIVE+HOMEPATH, HOME, or MEMORYMESH_HOME."
    );
  }

  const home = env.HOME?.trim();
  if (home) {
    return path.posix.resolve(home);
  }

  if (osHomeDir?.trim()) {
    return path.posix.resolve(osHomeDir);
  }

  throw new Error(
    "Unable to resolve user home directory. Set HOME or MEMORYMESH_HOME."
  );
}

