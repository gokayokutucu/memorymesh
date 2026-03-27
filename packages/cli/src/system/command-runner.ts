import execa, { Options } from "execa";

export interface ICommandRunOptions {
  cwd?: string;
  stdio?: "pipe" | "inherit";
  env?: NodeJS.ProcessEnv;
}

export interface ICommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface ICommandRunner {
  run(command: string, args?: string[], options?: ICommandRunOptions): Promise<ICommandResult>;
}

export class ExecaCommandRunner implements ICommandRunner {
  async run(
    command: string,
    args: string[] = [],
    options: ICommandRunOptions = {}
  ): Promise<ICommandResult> {
    const execaOptions: Options = {
      cwd: options.cwd,
      stdio: options.stdio ?? "pipe",
      env: options.env,
      reject: false,
    };

    const result = await execa(command, args, execaOptions);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      success: result.exitCode === 0,
    };
  }
}
