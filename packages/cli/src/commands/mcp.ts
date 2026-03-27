import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";

export interface IMcpCommandDeps {
  runner: ICommandRunner;
}

function createDefaultDeps(): IMcpCommandDeps {
  return {
    runner: new ExecaCommandRunner(),
  };
}

export async function runMcpCommand(
  _argv: string[],
  deps: Partial<IMcpCommandDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };
  const result = await resolved.runner.run(
    "npx",
    ["-y", "mcp-remote@next", "http://localhost:3456/mcp"],
    { stdio: "inherit" }
  );

  return result.success ? 0 : 1;
}
