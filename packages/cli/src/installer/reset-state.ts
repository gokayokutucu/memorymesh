import { resolve } from "node:path";
import {
  ensureInstallerManagedStack,
  getInstallerHomeDir,
  getInstallerManagedComposePath,
  getInstallerManagedStackDir,
  IInstallerManagedStackContext,
} from "./stack-packaging";
import { ICommandRunner } from "../system/command-runner";
import { ICheckResult, downMemoryMeshStack } from "../system/docker";
import { IFileSystem } from "../system/filesystem";
import { IStackContext } from "../system/stack-context";
import { joinFromHome } from "../system/runtime-home";

export interface IResetMemoryMeshStateInput {
  runner: ICommandRunner;
  fs: IFileSystem;
  homeDir: string;
  cwd: string;
  stackComposeExists: boolean;
  removePath(path: string): Promise<void>;
}

export interface IResetAndPrepareManagedStackInput extends IResetMemoryMeshStateInput {
  env: NodeJS.ProcessEnv;
}

export async function resetMemoryMeshState(
  input: IResetMemoryMeshStateInput
): Promise<ICheckResult> {
  const cleanupTargets: IStackContext[] = [];

  if (input.stackComposeExists) {
    cleanupTargets.push({
      projectDir: getInstallerManagedStackDir(input.homeDir),
      composeFilePath: getInstallerManagedComposePath(input.homeDir),
    });
  }

  const repoComposePath = resolve(input.cwd, "docker-compose.yml");
  if (
    input.fs.exists(repoComposePath)
    && !cleanupTargets.some((target) => target.composeFilePath === repoComposePath)
  ) {
    cleanupTargets.push({
      projectDir: input.cwd,
      composeFilePath: repoComposePath,
    });
  }

  const cleanedComposePaths: string[] = [];
  for (const cleanupStackContext of cleanupTargets) {
    const cleanupResult = await downMemoryMeshStack(
      input.runner,
      cleanupStackContext,
      true
    );
    if (!cleanupResult.ok) {
      return cleanupResult;
    }
    cleanedComposePaths.push(cleanupStackContext.composeFilePath);
  }

  await input.removePath(
    joinFromHome(input.homeDir, ".memorymesh", "checkpoints")
  );
  await input.removePath(getInstallerHomeDir(input.homeDir));
  return {
    ok: true,
    message:
      cleanedComposePaths.length > 0
        ? `Removed MemoryMesh state for compose: ${cleanedComposePaths.join(", ")}. Volumes were removed.`
        : "Removed installer-managed MemoryMesh state. No compose stack was present to clean.",
  };
}

export async function resetAndPrepareManagedStack(
  input: IResetAndPrepareManagedStackInput
): Promise<{ cleanup: ICheckResult; managedStack: IInstallerManagedStackContext } | { cleanup: ICheckResult }> {
  const cleanup = await resetMemoryMeshState(input);
  if (!cleanup.ok) {
    return { cleanup };
  }

  const managedStack = await ensureInstallerManagedStack(
    input.homeDir,
    input.fs,
    { cwd: input.cwd, env: input.env }
  );

  return {
    cleanup,
    managedStack,
  };
}
