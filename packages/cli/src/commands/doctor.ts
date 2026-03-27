import chalk from "chalk";
import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import {
  applyDoctorFixes,
  IDoctorCheck,
  IDoctorReport,
  runDoctorChecks,
} from "../system/doctor-checks";
import { readInstallConfig } from "../installer/first-run";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { IStackContext, resolveStackContext } from "../system/stack-context";

export interface IDoctorDeps {
  runner: ICommandRunner;
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  fs: IFileSystem;
  platform: NodeJS.Platform;
  appData?: string;
  stackContext?: IStackContext;
  write(line: string): void;
}

function createDefaultDeps(): IDoctorDeps {
  return {
    runner: new ExecaCommandRunner(),
    cwd: process.cwd(),
    env: process.env,
    homeDir: resolveUserHomeDir(process.platform, process.env),
    fs: nodeFileSystem,
    platform: process.platform,
    appData: process.env.APPDATA,
    write: console.log,
  };
}

function renderCheck(check: IDoctorCheck, write: (line: string) => void): void {
  const icon =
    check.severity === "healthy"
      ? chalk.green("PASS")
      : check.severity === "warning"
        ? chalk.yellow("WARN")
        : chalk.red("FAIL");
  write(`${icon}  ${check.name}  ${chalk.gray(check.message)}`);
}

function renderDoctorReport(
  report: IDoctorReport,
  write: (line: string) => void,
  title = "MemoryMesh Doctor"
): void {
  write(chalk.cyan(title));
  write("");

  for (const check of report.checks) {
    renderCheck(check, write);
  }

  write("");
  write(
    `Summary: healthy=${report.summary.healthy}, warning=${report.summary.warnings}, error=${report.summary.errors}`
  );
}

export async function runDoctorCommand(
  argv: string[],
  deps: Partial<IDoctorDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  const shouldFix = argv.includes("--fix");

  let stackContext: IStackContext;
  try {
    if (resolved.stackContext) {
      stackContext = resolved.stackContext;
    } else {
      const installConfig = await readInstallConfig(resolved.homeDir, resolved.fs);
      if (installConfig) {
        stackContext = {
          projectDir: installConfig.stackProjectDir,
          composeFilePath: installConfig.composeFilePath,
        };
      } else {
        stackContext = resolveStackContext(
          resolved.cwd,
          resolved.env,
          resolved.fs,
          resolved.homeDir
        );
      }
    }
  } catch (error) {
    resolved.write(chalk.red(`FAIL  Stack context  ${String(error)}`));
    return 1;
  }

  const report = await runDoctorChecks({
    runner: resolved.runner,
    stackContext,
    fs: resolved.fs,
    homeDir: resolved.homeDir,
    platform: resolved.platform,
    appData: resolved.appData,
  });
  renderDoctorReport(report, resolved.write);

  if (!shouldFix) {
    return report.summary.errors === 0 ? 0 : 1;
  }

  resolved.write("");
  resolved.write(chalk.cyan("Doctor Fix Mode"));
  if (report.fixActions.length === 0) {
    resolved.write("No automatic fixes available.");
  } else {
    resolved.write(`Attempting ${report.fixActions.length} fix action(s)...`);
    const fixResults = await applyDoctorFixes({
      runner: resolved.runner,
      stackContext,
      actions: report.fixActions,
      fs: resolved.fs,
      homeDir: resolved.homeDir,
      platform: resolved.platform,
      appData: resolved.appData,
    });

    for (const result of fixResults) {
      if (result.ok) {
        resolved.write(chalk.green(`FIXED  ${result.action}  ${result.message}`));
      } else {
        resolved.write(chalk.yellow(`SKIP   ${result.action}  ${result.message}`));
      }
    }
  }

  resolved.write("");
  const postFix = await runDoctorChecks({
    runner: resolved.runner,
    stackContext,
    fs: resolved.fs,
    homeDir: resolved.homeDir,
    platform: resolved.platform,
    appData: resolved.appData,
  });
  renderDoctorReport(postFix, resolved.write, "MemoryMesh Doctor (After Fix)");
  return postFix.summary.errors === 0 ? 0 : 1;
}
