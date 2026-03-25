import { ICommandRunner, ICommandRunOptions } from "../system/command-runner";
import { IStackContext } from "../system/stack-context";
import {
  pullOllamaModel,
  pullOllamaModelWithRetry,
  startMemoryMeshStack,
  verifySelectedEmbeddingModel,
  waitForOllamaReady,
} from "../system/docker";

interface IResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  success?: boolean;
}

class ScriptedRunner implements ICommandRunner {
  calls: Array<{ command: string; args: string[]; envModel?: string }> = [];

  constructor(private readonly script: Record<string, IResponse[] | IResponse>) {}

  async run(
    command: string,
    args: string[] = [],
    options?: ICommandRunOptions
  ): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
    this.calls.push({
      command,
      args,
      envModel: options?.env?.EMBEDDING_MODEL,
    });

    const key = `${command} ${args.join(" ")}`;
    const scripted = this.script[key];
    if (!scripted) {
      return {
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    const next = Array.isArray(scripted)
      ? scripted.shift() ?? scripted[scripted.length - 1]
      : scripted;

    return {
      stdout: next.stdout ?? "",
      stderr: next.stderr ?? "",
      exitCode: next.exitCode ?? (next.success === false ? 1 : 0),
      success: next.success ?? next.exitCode === 0,
    };
  }
}

const context: IStackContext = {
  projectDir: "/tmp/workspace",
  composeFilePath: "/tmp/workspace/docker-compose.yml",
};

describe("docker system commands", () => {
  it("starts stack in release-image mode via pull + up", async () => {
    const runner = new ScriptedRunner({});

    const result = await startMemoryMeshStack(runner, context, {}, "release-image");

    expect(result.ok).toBe(true);
    expect(runner.calls[0].args).toEqual([
      "compose",
      "-f",
      "/tmp/workspace/docker-compose.yml",
      "--project-directory",
      "/tmp/workspace",
      "pull",
    ]);
    expect(runner.calls[1].args).toEqual([
      "compose",
      "-f",
      "/tmp/workspace/docker-compose.yml",
      "--project-directory",
      "/tmp/workspace",
      "up",
      "-d",
    ]);
  });

  it("starts stack in local-dev-build mode without pull", async () => {
    const runner = new ScriptedRunner({});

    const result = await startMemoryMeshStack(runner, context, {}, "local-dev-build");

    expect(result.ok).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].args).toEqual([
      "compose",
      "-f",
      "/tmp/workspace/docker-compose.yml",
      "--project-directory",
      "/tmp/workspace",
      "up",
      "-d",
      "--build",
    ]);
  });

  it("pulls model via docker compose exec without container name", async () => {
    const runner = new ScriptedRunner({});

    const result = await pullOllamaModel(
      runner,
      "mxbai-embed-large",
      context,
      { EMBEDDING_MODEL: "mxbai-embed-large" }
    );

    expect(result.ok).toBe(true);
    expect(runner.calls[0].command).toBe("docker");
    expect(runner.calls[0].args).toEqual([
      "compose",
      "-f",
      "/tmp/workspace/docker-compose.yml",
      "--project-directory",
      "/tmp/workspace",
      "exec",
      "-T",
      "ollama",
      "ollama",
      "pull",
      "mxbai-embed-large",
    ]);
    expect(runner.calls[0].envModel).toBe("mxbai-embed-large");
  });

  it("waits for ollama readiness with retries", async () => {
    const key =
      "docker compose -f /tmp/workspace/docker-compose.yml --project-directory /tmp/workspace exec -T ollama ollama list";
    const runner = new ScriptedRunner({
      [key]: [
        { success: false, exitCode: 1 },
        { success: false, exitCode: 1 },
        { success: true, exitCode: 0, stdout: "NAME\n" },
      ],
    });

    const result = await waitForOllamaReady(runner, context, {}, { maxAttempts: 3, delayMs: 0 });
    expect(result.ok).toBe(true);
    expect(runner.calls).toHaveLength(3);
  });

  it("retries model pull and fails with clear message", async () => {
    const key =
      "docker compose -f /tmp/workspace/docker-compose.yml --project-directory /tmp/workspace exec -T ollama ollama pull nomic-embed-text";
    const runner = new ScriptedRunner({
      [key]: [
        { success: false, exitCode: 1 },
        { success: false, exitCode: 1 },
      ],
    });

    const result = await pullOllamaModelWithRetry(
      runner,
      "nomic-embed-text",
      context,
      {},
      { maxAttempts: 2, delayMs: 0 }
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("attempt 2/2");
  });

  it("verifies selected embedding model from memorymesh and ollama", async () => {
    const envKey =
      "docker compose -f /tmp/workspace/docker-compose.yml --project-directory /tmp/workspace exec -T memorymesh node -e process.stdout.write(process.env.EMBEDDING_MODEL ?? '')";
    const listKey =
      "docker compose -f /tmp/workspace/docker-compose.yml --project-directory /tmp/workspace exec -T ollama ollama list";
    const runner = new ScriptedRunner({
      [envKey]: { success: true, stdout: "nomic-embed-text" },
      [listKey]: { success: true, stdout: "NAME\nnomic-embed-text latest\n" },
    });

    const result = await verifySelectedEmbeddingModel(
      runner,
      context,
      "nomic-embed-text"
    );

    expect(result.ok).toBe(true);
  });
});
