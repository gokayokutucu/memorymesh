import { runSetupWizard } from "../installer/setup-wizard";
import { IFileSystem } from "../system/filesystem";
import { ICommandRunner } from "../system/command-runner";
import { IInstallerUi, ISpinner, ISpinnerFactory } from "../ui/installer-ui";
import { ApprovalOptions, ApprovalResult } from "../ui/approval";

const STACK_PATH = "/tmp/home/.memorymesh/stack/docker-compose.yml";
const STACK_DIR = "/tmp/home/.memorymesh/stack";

class FakeRunner implements ICommandRunner {
  calls: string[] = [];

  constructor(
    private readonly map: Record<string, { code: number; stdout?: string }> = {},
    private readonly activeEmbeddingModel: "nomic-embed-text" | "mxbai-embed-large" = "nomic-embed-text"
  ) {}

  async run(
    command: string,
    args: string[] = [],
    _options?: { cwd?: string; stdio?: "pipe" | "inherit"; env?: NodeJS.ProcessEnv }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
    const key = `${command} ${args.join(" ")}`;
    this.calls.push(key);
    const mapped = this.map[key];
    if (mapped) {
      return {
        stdout: mapped.stdout ?? "",
        stderr: mapped.code === 0 ? "" : "error",
        exitCode: mapped.code,
        success: mapped.code === 0,
      };
    }

    if (
      key ===
      `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} ps --status running --services`
    ) {
      return {
        stdout: "memorymesh\nmongodb\nneo4j\nqdrant\nollama\n",
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    if (
      key ===
      `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} exec -T ollama ollama list`
    ) {
      return {
        stdout: `NAME\n${this.activeEmbeddingModel} latest\n`,
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    if (
      key ===
      `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} exec -T memorymesh node -e process.stdout.write(process.env.EMBEDDING_MODEL ?? '')`
    ) {
      return {
        stdout: this.activeEmbeddingModel,
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    if (key === "curl -fsS http://localhost:3456/") {
      return {
        stdout: '{"name":"memorymesh","mcp_endpoint":"/mcp"}',
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    return {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      success: true,
    };
  }
}

class FakeSpinner implements ISpinner {
  constructor(
    private readonly onSucceed: (text: string) => void,
    private readonly onFail: (text: string) => void
  ) {}
  succeed(text: string): void {
    this.onSucceed(text);
  }
  fail(text: string): void {
    this.onFail(text);
  }
  stop(): void {}
}

class FakeSpinnerFactory implements ISpinnerFactory {
  started: string[] = [];
  succeeded: string[] = [];
  failed: string[] = [];

  start(text: string): ISpinner {
    this.started.push(text);
    return new FakeSpinner(
      (successText: string) => {
        this.succeeded.push(successText);
      },
      (failureText: string) => {
        this.failed.push(failureText);
      }
    );
  }
}

class FakeUi implements IInstallerUi {
  notes: string[] = [];
  dirtyPromptCalls = 0;
  confirmCalls = 0;
  approvalCalls = 0;
  embeddingPromptExistingDimension: number | null = null;

  constructor(
    private readonly shouldConfigureClaude = true,
    private readonly selectedEmbeddingModel: "nomic-embed-text" | "mxbai-embed-large" | null = "nomic-embed-text",
    private readonly dirtyStateAction: "clean_install" | "reuse_existing" | "exit" = "reuse_existing",
    private readonly confirmResponse = true,
    private readonly approvalResponse: ApprovalResult = { status: "approved" }
  ) {}

  async intro(): Promise<void> {}
  async outro(message: string): Promise<void> {
    this.notes.push(message);
  }
  async note(message: string): Promise<void> {
    this.notes.push(message);
  }
  async error(message: string): Promise<void> {
    this.notes.push(message);
  }
  async promptApproval(_options: ApprovalOptions): Promise<ApprovalResult> {
    this.approvalCalls += 1;
    return this.approvalResponse;
  }
  async confirm(_input: { message: string; initialValue?: boolean }): Promise<boolean | null> {
    this.confirmCalls += 1;
    return this.confirmResponse;
  }
  async selectDirtyStateAction(): Promise<"clean_install" | "reuse_existing" | "exit"> {
    this.dirtyPromptCalls += 1;
    return this.dirtyStateAction;
  }
  async selectEmbeddingModel(
    input?: { existingDimension: number | null }
  ): Promise<"nomic-embed-text" | "mxbai-embed-large" | null> {
    this.embeddingPromptExistingDimension = input?.existingDimension ?? null;
    if (!this.selectedEmbeddingModel) {
      return null;
    }
    return this.selectedEmbeddingModel;
  }
  async confirmClaudeIntegration(): Promise<boolean> {
    return this.shouldConfigureClaude;
  }
}

function createBaseRunnerMap(): Record<string, { code: number; stdout?: string }> {
  return {
    "docker --version": { code: 0 },
    "docker info": { code: 0 },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} pull`]: { code: 0 },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} up -d`]: { code: 0 },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} up -d --build`]: {
      code: 0,
    },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} up -d ollama`]: {
      code: 0,
    },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} exec -T ollama ollama pull nomic-embed-text`]: {
      code: 0,
    },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} exec -T ollama ollama pull mxbai-embed-large`]: {
      code: 0,
    },
    "curl -sS -m 5 -H Accept: application/json -w HTTPSTATUS:%{http_code} http://localhost:3456/health": {
      code: 0,
      stdout: '{"name":"memorymesh","status":"ok","transport":"http","mcp_endpoint":"/mcp"}HTTPSTATUS:200',
    },
    [`docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} down --volumes --remove-orphans`]: {
      code: 0,
    },
  };
}

describe("setup wizard", () => {
  it("uses local-dev-build mode when MEMORYMESH_USE_LOCAL_BUILD=true", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(false);
    const runner = new FakeRunner(createBaseRunnerMap());

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "true" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} up -d --build`
      )
    ).toBe(true);
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} pull`
      )
    ).toBe(false);
    expect(ui.dirtyPromptCalls).toBe(0);
  });

  it("continues gracefully when Claude integration is skipped", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(false);

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(createBaseRunnerMap()),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(ui.notes.some((note) => note.includes("MemoryMesh MCP configured"))).toBe(false);
    expect(
      ui.notes.some((note) => note.includes("Please fully close and reopen Claude Desktop"))
    ).toBe(false);
  });

  it("continues safely when Claude config file is missing", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        !path.endsWith("claude_desktop_config.json"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(true);

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(createBaseRunnerMap()),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(
      ui.notes.some((note) =>
        note.includes("Claude Desktop config file is missing")
      )
    ).toBe(true);
  });

  it("continues with actionable message when Claude config is invalid JSON", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith("claude_desktop_config.json"),
      mkdir: async () => {},
      read: async (path: string) =>
        path.endsWith("claude_desktop_config.json") ? "{" : "{}",
      write: async () => {},
    };
    const ui = new FakeUi(true);

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(createBaseRunnerMap()),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(
      ui.notes.some((note) => note.includes("Claude integration update failed"))
    ).toBe(true);
  });

  it("shows restart instructions when Claude integration succeeds", async () => {
    const writes: string[] = [];
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith("claude_desktop_config.json"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async (path, content) => {
        writes.push(`${path}:${content}`);
      },
    };
    const ui = new FakeUi(true);

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(createBaseRunnerMap()),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(writes.some((entry) => entry.includes("claude_desktop_config.json"))).toBe(true);
    expect(
      ui.notes.some((note) =>
        note.includes("MemoryMesh MCP has been added to Claude Desktop configuration")
      )
    ).toBe(true);
    expect(ui.notes.some((note) => note.includes("Runtime target validation passed"))).toBe(true);
    expect(
      ui.notes.some((note) => note.includes("Please fully close and reopen Claude Desktop"))
    ).toBe(true);
    expect(
      ui.notes.some((note) =>
        note.includes("MemoryMesh MCP will not appear until Claude Desktop is restarted")
      )
    ).toBe(true);
  });

  it("falls back to persisted embedding dimension for setup labels when qdrant dimension is unavailable", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh/config.json"),
      mkdir: async () => {},
      read: async (path: string) => {
        if (path.endsWith(".memorymesh/config.json")) {
          return JSON.stringify({
            installState: "installed",
            embeddingMode: "flash",
            embeddingModel: "nomic-embed-text",
            embeddingDimension: 768,
            installedAt: new Date().toISOString(),
            stackProjectDir: STACK_DIR,
            composeFilePath: STACK_PATH,
          });
        }
        return "{}";
      },
      write: async () => {},
    };
    const ui = new FakeUi(false);
    const runner = new FakeRunner(createBaseRunnerMap());

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(ui.embeddingPromptExistingDimension).toBe(768);
  });

  it("keeps installer idempotent when MemoryMesh MCP entry already exists", async () => {
    const writes: string[] = [];
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith("claude_desktop_config.json"),
      mkdir: async () => {},
      read: async (path: string) =>
        path.endsWith("claude_desktop_config.json")
          ? JSON.stringify({
              mcpServers: {
                memorymesh: { command: "memorymesh", args: ["mcp"] },
              },
              theme: "dark",
            })
          : "{}",
      write: async (path, content) => {
        writes.push(`${path}:${content}`);
      },
    };
    const ui = new FakeUi(true);

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(createBaseRunnerMap()),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(
      ui.notes.some((note) => note.includes("already exists and is up to date"))
    ).toBe(true);
    expect(
      writes.some((entry) => entry.includes("claude_desktop_config.json"))
    ).toBe(false);
    expect(
      ui.notes.some((note) => note.includes("Please fully close and reopen Claude Desktop"))
    ).toBe(true);
  });

  it("warns when MCP target validation fails after Claude config update", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith("claude_desktop_config.json"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(true);
    const map = createBaseRunnerMap();
    map["curl -fsS http://localhost:3456/"] = { code: 1 };

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(map),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(
      ui.notes.some((note) => note.includes("Runtime target validation failed"))
    ).toBe(true);
    expect(
      ui.notes.some((note) => note.includes("entry was written to Claude Desktop configuration"))
    ).toBe(true);
    expect(
      ui.notes.some((note) => note.includes("Please fully close and reopen Claude Desktop"))
    ).toBe(true);
    expect(ui.notes.some((note) => note.includes("run memorymesh doctor"))).toBe(true);
  });

  it("prompts for dirty state and supports clean install cleanup", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh") ||
        path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const map = createBaseRunnerMap();
    map["curl -fsS http://localhost:6333/collections/memories"] = {
      code: 0,
      stdout: JSON.stringify({
        result: {
          config: {
            params: {
              vectors: {
                size: 768,
              },
            },
          },
        },
      }),
    };
    const runner = new FakeRunner(map, "mxbai-embed-large");
    const ui = new FakeUi(false, "mxbai-embed-large", "clean_install");
    const removedPaths: string[] = [];
    const spinnerFactory = new FakeSpinnerFactory();

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory,
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
      removePath: async (path: string) => {
        removedPaths.push(path);
      },
    });

    expect(code).toBe("completed");
    expect(ui.dirtyPromptCalls).toBe(1);
    expect(ui.approvalCalls).toBe(0);
    expect(spinnerFactory.started).toEqual(
      expect.arrayContaining([
        "Stopping existing stack...",
        "Removing containers and volumes...",
        "Clearing vector store...",
        "Removing installer-managed state...",
        "Preparing fresh environment...",
      ])
    );
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} down --volumes --remove-orphans`
      )
    ).toBe(true);
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} down --remove-orphans`
      )
    ).toBe(true);
    expect(
      runner.calls.includes("curl -fsS -X DELETE http://localhost:6333/collections/memories")
    ).toBe(true);
    expect(removedPaths).toContain("/tmp/home/.memorymesh");
    expect(removedPaths).toContain("/tmp/home/.memorymesh/checkpoints");
    expect(ui.embeddingPromptExistingDimension).toBeNull();
    expect(
      runner.calls.includes("curl -fsS http://localhost:6333/collections/memories")
    ).toBe(true);
    expect(
      runner.calls.includes(
        'curl -fsS -X PUT http://localhost:6333/collections/memories -H Content-Type: application/json -d {"vectors":{"size":1024,"distance":"Cosine"}}'
      )
    ).toBe(true);
  });

  it("rolls back transient managed state when clean-install run is cancelled before completion", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh") ||
        path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const runner = new FakeRunner(createBaseRunnerMap());
    const ui = new FakeUi(false, null, "clean_install");
    const removedPaths: string[] = [];

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
      removePath: async (path: string) => {
        removedPaths.push(path);
      },
    });

    expect(code).toBe("cancelled");
    expect(
      runner.calls.filter(
        (call) =>
          call
          === `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} down --volumes --remove-orphans`
      ).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      removedPaths.filter((path) => path === "/tmp/home/.memorymesh").length
    ).toBeGreaterThanOrEqual(2);
    expect(
      removedPaths.filter((path) => path === "/tmp/home/.memorymesh/checkpoints").length
    ).toBeGreaterThanOrEqual(2);
    expect(ui.embeddingPromptExistingDimension).toBeNull();
  });

  it("prompts for dirty state and supports reuse existing data", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh") ||
        path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const runner = new FakeRunner(createBaseRunnerMap());
    const ui = new FakeUi(false, "nomic-embed-text", "reuse_existing");

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(ui.dirtyPromptCalls).toBe(1);
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} down --volumes --remove-orphans`
      )
    ).toBe(false);
  });

  it("reuses existing-data branch and still passes detected existing dimension", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh") ||
        path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const map = createBaseRunnerMap();
    map["curl -fsS http://localhost:6333/collections/memories"] = {
      code: 0,
      stdout: JSON.stringify({
        result: {
          config: {
            params: {
              vectors: {
                size: 1024,
              },
            },
          },
        },
      }),
    };
    const runner = new FakeRunner(map);
    const ui = new FakeUi(false, "nomic-embed-text", "reuse_existing");

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("completed");
    expect(ui.embeddingPromptExistingDimension).toBe(1024);
    expect(
      runner.calls.includes("curl -fsS http://localhost:6333/collections/memories")
    ).toBe(true);
  });

  it("exits setup when dirty state prompt selects exit", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") ||
        path.endsWith("package.json") ||
        path.endsWith(".memorymesh") ||
        path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const runner = new FakeRunner(createBaseRunnerMap());
    const ui = new FakeUi(false, "nomic-embed-text", "exit");

    const code = await runSetupWizard({
      fs,
      ui,
      runner,
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
    });

    expect(code).toBe("cancelled");
    expect(ui.dirtyPromptCalls).toBe(1);
    expect(
      runner.calls.includes(
        `docker compose -f ${STACK_PATH} --project-directory ${STACK_DIR} up -d`
      )
    ).toBe(false);
  });

  it("automatically resets managed state when selected dimension mismatches existing collection", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile")
        || path.endsWith("package.json")
        || path.endsWith(".memorymesh")
        || path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(false, "mxbai-embed-large", "reuse_existing");
    const removedPaths: string[] = [];
    const map = createBaseRunnerMap();
    map["curl -fsS http://localhost:6333/collections/memories"] = {
      code: 0,
      stdout: JSON.stringify({
        result: {
          config: {
            params: {
              vectors: { size: 768 },
            },
          },
        },
      }),
    };

    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(map, "mxbai-embed-large"),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
      removePath: async (path: string) => {
        removedPaths.push(path);
      },
    });

    expect(code).toBe("completed");
    expect(ui.approvalCalls).toBe(1);
    expect(removedPaths).toContain("/tmp/home/.memorymesh");
    expect(
      ui.notes.some((note) => note.includes("Selected model requires reset of existing embedding data"))
    ).toBe(true);
    expect(
      ui.notes.some((note) => note.includes("Reset complete. Continuing setup with new embedding model"))
    ).toBe(true);
  });

  it("exits setup immediately when destructive reset confirmation is declined", async () => {
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile")
        || path.endsWith("package.json")
        || path.endsWith(".memorymesh")
        || path.endsWith("stack/docker-compose.yml"),
      mkdir: async () => {},
      read: async () => "{}",
      write: async () => {},
    };
    const ui = new FakeUi(
      false,
      "mxbai-embed-large",
      "reuse_existing",
      false,
      { status: "rejected" }
    );
    const removedPaths: string[] = [];
    const map = createBaseRunnerMap();
    map["curl -fsS http://localhost:6333/collections/memories"] = {
      code: 0,
      stdout: JSON.stringify({
        result: {
          config: {
            params: {
              vectors: { size: 768 },
            },
          },
        },
      }),
    };
    const code = await runSetupWizard({
      fs,
      ui,
      runner: new FakeRunner(map, "mxbai-embed-large"),
      spinnerFactory: new FakeSpinnerFactory(),
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" },
      homeDir: "/tmp/home",
      platform: "darwin",
      removePath: async (path: string) => {
        removedPaths.push(path);
      },
    });

    expect(code).toBe("cancelled");
    expect(ui.approvalCalls).toBe(1);
    expect(removedPaths).toHaveLength(0);
    expect(
      ui.notes.some((note) => note.includes("Setup cancelled. No changes were made."))
    ).toBe(true);
  });
});
