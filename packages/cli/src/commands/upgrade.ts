import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { readInstallConfig } from "../installer/first-run";
import { resolveUserHomeDir } from "../system/runtime-home";

export interface IUpgradeDeps {
  runner: ICommandRunner;
  fs: IFileSystem;
  homeDir: string;
  write(line: string): void;
}

function createDefaultDeps(): IUpgradeDeps {
  return {
    runner: new ExecaCommandRunner(),
    fs: nodeFileSystem,
    homeDir: resolveUserHomeDir(process.platform, process.env),
    write: console.log,
  };
}

export async function runUpgradeCommand(
  _argv: string[],
  deps: Partial<IUpgradeDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };

  const config = await readInstallConfig(resolved.homeDir, resolved.fs);
  if (!config) {
    resolved.write("MemoryMesh is not installed. Run `memorymesh` to start setup.");
    return 1;
  }

  resolved.write("memorymesh upgrade (scaffold)");
  resolved.write("Planned upgrade responsibilities:");
  resolved.write("- config schema migration");
  resolved.write("- stack image/compose upgrades");
  resolved.write("- embedding model change handling");
  resolved.write("");
  resolved.write("No upgrade actions were applied in this version.");
  return 0;
}
