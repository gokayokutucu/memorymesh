import { runDoctorCommand } from "../commands/doctor";
import { ICommandRunner, ICommandRunOptions, ICommandResult } from "../system/command-runner";
import { IFileSystem } from "../system/filesystem";

const HOME_DIR = "/tmp/home";
const APP_DATA = "C:/Users/test/AppData/Roaming";
const STACK_CONTEXT = {
  projectDir: "/tmp/home/.memorymesh/stack",
  composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
};
const CONFIG_PATH = `${HOME_DIR}/.memorymesh/config.json`;
const RUNTIME_ENV_PATH = `${HOME_DIR}/.memorymesh/runtime.env`;
const CLAUDE_PATH_DARWIN =
  `${HOME_DIR}/Library/Application Support/Claude/claude_desktop_config.json`;

class MemoryFs implements IFileSystem {
  private readonly files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, content);
    }
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  async mkdir(_path: string): Promise<void> {}

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`Missing file: ${path}`);
    }

    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  get(path: string): string | undefined {
    return this.files.get(path);
  }
}

class StatefulRunner implements ICommandRunner {
  dockerInstalled = true;
  dockerDaemon = true;
  apiHealthy = true;
  mcpRootReachable = true;
  runningServices = new Set<string>(["memorymesh", "mongodb", "neo4j", "qdrant", "ollama"]);
  ollamaModels = new Set<string>(["nomic-embed-text:latest"]);
  lastOllamaListEnv: NodeJS.ProcessEnv | undefined;
  calls: string[] = [];

  async run(
    command: string,
    args: string[] = [],
    options?: ICommandRunOptions
  ): Promise<ICommandResult> {
    const key = `${command} ${args.join(" ")}`;
    this.calls.push(key);

    if (key === "docker --version") {
      return this.result(this.dockerInstalled, "Docker version 26.1.0");
    }

    if (key === "docker info") {
      return this.result(this.dockerDaemon, "Docker daemon is running");
    }

    if (
      key ===
      "curl -sS -m 5 -H Accept: application/json -w HTTPSTATUS:%{http_code} http://localhost:3456/health"
    ) {
      const statusCode = this.apiHealthy ? 200 : 404;
      const payload = this.apiHealthy
        ? '{"name":"memorymesh","status":"ok","transport":"http","mcp_endpoint":"/mcp"}'
        : '{"error":"not found"}';
      return this.result(true, `${payload}HTTPSTATUS:${statusCode}`);
    }

    if (key === "curl -fsS http://localhost:3456/") {
      const stdout = this.mcpRootReachable
        ? '{"name":"memorymesh","mcp_endpoint":"/mcp"}'
        : "";
      return this.result(this.mcpRootReachable, stdout);
    }

    const composePrefix = `docker compose -f ${STACK_CONTEXT.composeFilePath} --project-directory ${STACK_CONTEXT.projectDir}`;

    if (key === `${composePrefix} ps --status running --services`) {
      return this.result(true, `${Array.from(this.runningServices).join("\n")}\n`);
    }

    if (key === `${composePrefix} pull`) {
      return this.result(true, "pulled");
    }

    if (key === `${composePrefix} up -d`) {
      this.runningServices = new Set(["memorymesh", "mongodb", "neo4j", "qdrant", "ollama"]);
      this.apiHealthy = true;
      return this.result(true, "started");
    }

    if (key === `${composePrefix} up -d ollama`) {
      this.runningServices.add("ollama");
      return this.result(true, "started ollama");
    }

    if (key === `${composePrefix} exec -T ollama ollama list`) {
      const ready = this.runningServices.has("ollama");
      this.lastOllamaListEnv = options?.env;
      const modelLines = Array.from(this.ollamaModels).join("\n");
      return this.result(ready, `NAME\n${modelLines}\n`);
    }

    const pullPrefix = `${composePrefix} exec -T ollama ollama pull `;
    if (key.startsWith(pullPrefix)) {
      const model = key.slice(pullPrefix.length);
      this.ollamaModels.add(model);
      return this.result(true, `pulled ${model}`);
    }

    return this.result(true, "ok");
  }

  private result(success: boolean, stdout: string): ICommandResult {
    return {
      stdout,
      stderr: success ? "" : "error",
      exitCode: success ? 0 : 1,
      success,
    };
  }
}

function validInstallConfig(): string {
  return JSON.stringify(
    {
      installState: "installed",
      embeddingMode: "flash",
      embeddingModel: "nomic-embed-text",
      embeddingDimension: 768,
      installedAt: "2026-03-17T10:00:00.000Z",
      stackProjectDir: STACK_CONTEXT.projectDir,
      composeFilePath: STACK_CONTEXT.composeFilePath,
    },
    null,
    2
  );
}

function validRuntimeEnv(): string {
  return [
    "MEMORYMESH_EMBEDDING_MODE=flash",
    "EMBEDDING_MODEL=nomic-embed-text",
    "MEMORYMESH_EMBEDDING_DIMENSION=768",
    "",
  ].join("\n");
}

function validClaudeConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        memorymesh: {
          command: "memorymesh",
          args: ["mcp"],
        },
      },
      theme: "light",
    },
    null,
    2
  );
}

function createBaselineFs(): MemoryFs {
  return new MemoryFs({
    [CONFIG_PATH]: validInstallConfig(),
    [RUNTIME_ENV_PATH]: validRuntimeEnv(),
    [CLAUDE_PATH_DARWIN]: validClaudeConfig(),
  });
}

async function runDoctor(
  argv: string[],
  fs: IFileSystem,
  runner: ICommandRunner,
  write: (line: string) => void
): Promise<number> {
  return runDoctorCommand(argv, {
    fs,
    runner,
    write,
    homeDir: HOME_DIR,
    appData: APP_DATA,
    platform: "darwin",
    stackContext: STACK_CONTEXT,
  });
}

describe("doctor command", () => {
  it("detects invalid install config", async () => {
    const fs = createBaselineFs();
    await fs.write(CONFIG_PATH, "{");
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(1);
    expect(write.mock.calls.some((call) => call[0].includes("Install config"))).toBe(true);
    expect(write.mock.calls.some((call) => call[0].includes("invalid JSON"))).toBe(true);
  });

  it("detects missing runtime env", async () => {
    const fs = new MemoryFs({
      [CONFIG_PATH]: validInstallConfig(),
      [CLAUDE_PATH_DARWIN]: validClaudeConfig(),
    });
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect((fs.get(RUNTIME_ENV_PATH) ?? "").includes("EMBEDDING_MODEL=nomic-embed-text")).toBe(true);
    expect(
      write.mock.calls.some((call) =>
        call[0].includes("Runtime env was regenerated from install config")
      )
    ).toBe(true);
  });

  it("detects missing selected embedding model", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    runner.ollamaModels = new Set<string>();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(1);
    expect(
      write.mock.calls.some((call) =>
        call[0].includes("Selected embedding model in Ollama") && call[0].includes("missing")
      )
    ).toBe(true);
  });

  it("passes embedding model check when ollama list contains tagged model", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect(
      write.mock.calls.some((call) =>
        call[0].includes("Selected embedding model in Ollama")
        && call[0].includes("nomic-embed-text is installed")
      )
    ).toBe(true);
  });

  it("passes embedding model check when ollama list contains untagged model", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    runner.ollamaModels = new Set<string>(["nomic-embed-text"]);
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect(
      write.mock.calls.some((call) =>
        call[0].includes("Selected embedding model in Ollama")
        && call[0].includes("nomic-embed-text is installed")
      )
    ).toBe(true);
  });

  it("passes runtime env into doctor ollama list check", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect(runner.lastOllamaListEnv?.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(runner.lastOllamaListEnv?.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(runner.lastOllamaListEnv?.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("detects missing Claude Desktop config", async () => {
    const fs = new MemoryFs({
      [CONFIG_PATH]: validInstallConfig(),
      [RUNTIME_ENV_PATH]: validRuntimeEnv(),
    });
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect(write.mock.calls.some((call) => call[0].includes("Claude Desktop config is missing"))).toBe(true);
  });

  it("detects mismatched Claude MemoryMesh MCP entry", async () => {
    const fs = createBaselineFs();
    await fs.write(
      CLAUDE_PATH_DARWIN,
      JSON.stringify({
        mcpServers: {
          memorymesh: {
            command: "node",
            args: ["server.js"],
          },
        },
      })
    );
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor([], fs, runner, write);

    expect(code).toBe(0);
    expect(
      write.mock.calls.some((call) => call[0].includes("MemoryMesh MCP entry") && call[0].includes("mismatched"))
    ).toBe(true);
  });

  it("doctor --fix restarts stack when services are stopped", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    runner.runningServices = new Set<string>();
    runner.apiHealthy = false;
    const write = jest.fn<void, [string]>();

    const code = await runDoctor(["--fix"], fs, runner, write);

    expect(code).toBe(0);
    expect(runner.calls.some((call) => call.endsWith("pull"))).toBe(true);
    expect(runner.calls.some((call) => call.endsWith("up -d"))).toBe(true);
    expect(write.mock.calls.some((call) => call[0].includes("After Fix"))).toBe(true);
  });

  it("doctor --fix re-pulls missing embedding model", async () => {
    const fs = createBaselineFs();
    const runner = new StatefulRunner();
    runner.ollamaModels = new Set<string>();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor(["--fix"], fs, runner, write);

    expect(code).toBe(0);
    expect(runner.calls.some((call) => call.includes("up -d ollama"))).toBe(true);
    expect(runner.calls.some((call) => call.includes("ollama pull nomic-embed-text"))).toBe(true);
    expect(write.mock.calls.some((call) => call[0].includes("repull_embedding_model"))).toBe(true);
  });

  it("doctor --fix repairs Claude MCP config", async () => {
    const fs = createBaselineFs();
    await fs.write(CLAUDE_PATH_DARWIN, JSON.stringify({ mcpServers: {} }));
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor(["--fix"], fs, runner, write);
    const updated = fs.get(CLAUDE_PATH_DARWIN) ?? "";

    expect(code).toBe(0);
    expect(updated.includes('"memorymesh"')).toBe(true);
    expect(updated.includes('"command": "memorymesh"')).toBe(true);
    expect(write.mock.calls.some((call) => call[0].includes("repair_claude_mcp"))).toBe(true);
  });

  it("doctor --fix regenerates runtime env when missing", async () => {
    const fs = new MemoryFs({
      [CONFIG_PATH]: validInstallConfig(),
      [CLAUDE_PATH_DARWIN]: validClaudeConfig(),
    });
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor(["--fix"], fs, runner, write);

    expect(code).toBe(0);
    expect((fs.get(RUNTIME_ENV_PATH) ?? "").includes("MEMORYMESH_EMBEDDING_MODE=flash")).toBe(true);
    expect((fs.get(RUNTIME_ENV_PATH) ?? "").includes("EMBEDDING_MODEL=nomic-embed-text")).toBe(true);
    expect((fs.get(RUNTIME_ENV_PATH) ?? "").includes("MEMORYMESH_EMBEDDING_DIMENSION=768")).toBe(true);
    expect(
      write.mock.calls.some((call) =>
        call[0].includes("Runtime env was regenerated from install config")
      )
    ).toBe(true);
  });

  it("returns non-zero after --fix when errors remain", async () => {
    const fs = createBaselineFs();
    await fs.write(CONFIG_PATH, "{");
    const runner = new StatefulRunner();
    const write = jest.fn<void, [string]>();

    const code = await runDoctor(["--fix"], fs, runner, write);

    expect(code).toBe(1);
    expect(write.mock.calls.some((call) => call[0].includes("After Fix"))).toBe(true);
    expect(write.mock.calls.some((call) => call[0].includes("Install config"))).toBe(true);
  });
});
