import { rm } from "node:fs/promises";
import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import {
  downMemoryMeshStack,
  startMemoryMeshStack,
  stopMemoryMeshStack,
} from "../system/docker";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { IStackContext, resolveStackContext } from "../system/stack-context";
import { readInstallConfig } from "../installer/first-run";
import {
  getInstallerHomeDir,
  resolveInstallerManagedStack,
} from "../installer/stack-packaging";
import { resolveUserHomeDir } from "../system/runtime-home";
import { resolveAuthoritativeEmbeddingConfig } from "../installer/embedding-authority";

export interface ILifecycleDeps {
  runner: ICommandRunner;
  fs: IFileSystem;
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  write(line: string): void;
  removePath(path: string): Promise<void>;
}

function createDefaultDeps(): ILifecycleDeps {
  return {
    runner: new ExecaCommandRunner(),
    fs: nodeFileSystem,
    cwd: process.cwd(),
    env: process.env,
    homeDir: resolveUserHomeDir(process.platform, process.env),
    write: console.log,
    async removePath(path: string): Promise<void> {
      await rm(path, { recursive: true, force: true });
    },
  };
}

async function resolveLifecycleStackContext(
  deps: ILifecycleDeps
): Promise<{
  context: IStackContext;
  mode: "release-image" | "local-dev-build";
}> {
  const config = await readInstallConfig(deps.homeDir, deps.fs);
  if (config) {
    return {
      context: {
        projectDir: config.stackProjectDir,
        composeFilePath: config.composeFilePath,
      },
      mode: config.stackMode ?? "release-image",
    };
  }

  return {
    context: resolveStackContext(deps.cwd, deps.env, deps.fs, deps.homeDir),
    mode: "release-image",
  };
}

function hasArg(argv: string[], token: string): boolean {
  return argv.includes(token);
}

async function confirmPrompt(message: string, initialValue: boolean): Promise<boolean> {
  const clack = await import("@clack/prompts");
  const answer = await clack.confirm({ message, initialValue });
  if (clack.isCancel(answer)) {
    return false;
  }

  return answer;
}

export async function runStartCommand(
  _argv: string[],
  deps: Partial<ILifecycleDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  try {
    const { context: stackContext, mode } = await resolveLifecycleStackContext(resolved);
    const authority = await resolveAuthoritativeEmbeddingConfig(
      resolved.homeDir,
      resolved.fs
    );
    const result = await startMemoryMeshStack(
      resolved.runner,
      stackContext,
      authority.runtimeEnv,
      mode
    );
    resolved.write(result.message);
    return result.ok ? 0 : 1;
  } catch (error) {
    resolved.write(String(error));
    return 1;
  }
}

export async function runStopCommand(
  _argv: string[],
  deps: Partial<ILifecycleDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  const { context: stackContext } = await resolveLifecycleStackContext(resolved);
  const result = await stopMemoryMeshStack(resolved.runner, stackContext);
  resolved.write(result.message);
  return result.ok ? 0 : 1;
}

export async function runResetCommand(
  argv: string[],
  deps: Partial<ILifecycleDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  const { context: stackContext } = await resolveLifecycleStackContext(resolved);

  const fullReset = hasArg(argv, "--full");
  const forceYes = hasArg(argv, "--yes");

  if (fullReset && !forceYes) {
    const approved = await confirmPrompt(
      "Run full reset (this removes Docker volumes)?",
      false
    );
    if (!approved) {
      resolved.write("Reset cancelled.");
      return 0;
    }
  }

  const result = await downMemoryMeshStack(resolved.runner, stackContext, fullReset);
  resolved.write(result.message);
  if (!result.ok) {
    return 1;
  }

  resolved.write("Installer config preserved.");
  return 0;
}

export async function runUninstallCommand(
  argv: string[],
  deps: Partial<ILifecycleDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  const forceYes = hasArg(argv, "--yes");

  if (!forceYes) {
    const approved = await confirmPrompt(
      "Uninstall MemoryMesh and remove ~/.memorymesh?",
      false
    );
    if (!approved) {
      resolved.write("Uninstall cancelled.");
      return 0;
    }
  }

  const stackContext = resolveInstallerManagedStack(resolved.homeDir, resolved.fs)
    ?? (await resolveLifecycleStackContext(resolved)).context;

  const downResult = await downMemoryMeshStack(resolved.runner, stackContext, true);
  if (!downResult.ok) {
    resolved.write(downResult.message);
    return 1;
  }

  await resolved.removePath(getInstallerHomeDir(resolved.homeDir));
  resolved.write("MemoryMesh uninstalled.");
  return 0;
}
