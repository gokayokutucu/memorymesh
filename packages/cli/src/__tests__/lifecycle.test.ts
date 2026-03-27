import {
  runResetCommand,
  runStartCommand,
  runStopCommand,
  runUninstallCommand,
} from "../commands/lifecycle";
import { ICommandRunner, ICommandRunOptions } from "../system/command-runner";
import { IFileSystem } from "../system/filesystem";

class CaptureRunner implements ICommandRunner {
  calls: string[] = [];
  envByCall = new Map<string, NodeJS.ProcessEnv | undefined>();

  constructor(private readonly fails: Record<string, boolean> = {}) {}

  async run(
    command: string,
    args: string[] = [],
    options?: ICommandRunOptions
  ): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
    const key = `${command} ${args.join(" ")}`;
    this.calls.push(key);
    this.envByCall.set(key, options?.env);
    const failed = this.fails[key] === true;
    return {
      stdout: failed ? "" : "ok",
      stderr: "",
      exitCode: failed ? 1 : 0,
      success: !failed,
    };
  }
}

function createFs(files: Record<string, string>): IFileSystem {
  return {
    exists: (path: string) => Object.prototype.hasOwnProperty.call(files, path),
    mkdir: async () => {},
    read: async (path: string) => files[path] ?? "",
    write: async (path: string, content: string) => {
      files[path] = content;
    },
  };
}

const configPath = "/tmp/home/.memorymesh/config.json";
const runtimeEnvPath = "/tmp/home/.memorymesh/runtime.env";
const composePath = "/tmp/home/.memorymesh/stack/docker-compose.yml";

describe("lifecycle commands", () => {
  it("starts stack using stored config context", async () => {
    const files: Record<string, string> = {
      [configPath]: JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: composePath,
      }),
      [runtimeEnvPath]:
        "MEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n",
      [composePath]: "services:{}",
    };
    const fs = createFs(files);
    const runner = new CaptureRunner();

    const code = await runStartCommand([], {
      homeDir: "/tmp/home",
      fs,
      runner,
      cwd: "/tmp/nowhere",
      env: {},
      write: () => {},
      removePath: async () => {},
    });

    expect(code).toBe(0);
    expect(runner.calls).toContain(
      `docker compose -f ${composePath} --project-directory /tmp/home/.memorymesh/stack pull`
    );
  });

  it("ignores ambient embedding env and uses config.json authority for start", async () => {
    const files: Record<string, string> = {
      [configPath]: JSON.stringify({
        installState: "installed",
        embeddingMode: "medium",
        embeddingModel: "mxbai-embed-large",
        embeddingDimension: 1024,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: composePath,
      }),
      [runtimeEnvPath]:
        "MEMORYMESH_EMBEDDING_MODE=flash\nEMBEDDING_MODEL=nomic-embed-text\nMEMORYMESH_EMBEDDING_DIMENSION=768\n",
      [composePath]: "services:{}",
    };
    const fs = createFs(files);
    const runner = new CaptureRunner();

    const code = await runStartCommand([], {
      homeDir: "/tmp/home",
      fs,
      runner,
      cwd: "/tmp/nowhere",
      env: {
        EMBEDDING_MODEL: "nomic-embed-text",
        MEMORYMESH_EMBEDDING_MODE: "flash",
        MEMORYMESH_EMBEDDING_DIMENSION: "768",
      },
      write: () => {},
      removePath: async () => {},
    });

    expect(code).toBe(0);
    const pullCall =
      `docker compose -f ${composePath} --project-directory /tmp/home/.memorymesh/stack pull`;
    expect(runner.envByCall.get(pullCall)?.EMBEDDING_MODEL).toBe("mxbai-embed-large");
    expect(runner.envByCall.get(pullCall)?.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
    expect(runner.envByCall.get(pullCall)?.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
  });

  it("stops stack", async () => {
    const files: Record<string, string> = {
      [configPath]: JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: composePath,
      }),
      [composePath]: "services:{}",
    };
    const fs = createFs(files);
    const runner = new CaptureRunner();

    const code = await runStopCommand([], {
      homeDir: "/tmp/home",
      fs,
      runner,
      cwd: "/tmp/nowhere",
      env: {},
      write: () => {},
      removePath: async () => {},
    });

    expect(code).toBe(0);
    expect(runner.calls).toContain(
      `docker compose -f ${composePath} --project-directory /tmp/home/.memorymesh/stack stop`
    );
  });

  it("reset keeps config by default", async () => {
    const files: Record<string, string> = {
      [configPath]: JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: composePath,
      }),
      [composePath]: "services:{}",
    };
    const fs = createFs(files);
    const runner = new CaptureRunner();

    const code = await runResetCommand(["--yes"], {
      homeDir: "/tmp/home",
      fs,
      runner,
      cwd: "/tmp/nowhere",
      env: {},
      write: () => {},
      removePath: async () => {},
    });

    expect(code).toBe(0);
    expect(runner.calls).toContain(
      `docker compose -f ${composePath} --project-directory /tmp/home/.memorymesh/stack down --remove-orphans`
    );
    expect(files[configPath]).toBeDefined();
  });

  it("uninstall removes installer home", async () => {
    const files: Record<string, string> = {
      [configPath]: JSON.stringify({
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/home/.memorymesh/stack",
        composeFilePath: composePath,
      }),
      [composePath]: "services:{}",
    };
    const fs = createFs(files);
    const runner = new CaptureRunner();
    const removed: string[] = [];

    const code = await runUninstallCommand(["--yes"], {
      homeDir: "/tmp/home",
      fs,
      runner,
      cwd: "/tmp/nowhere",
      env: {},
      write: () => {},
      removePath: async (path: string) => {
        removed.push(path);
      },
    });

    expect(code).toBe(0);
    expect(runner.calls).toContain(
      `docker compose -f ${composePath} --project-directory /tmp/home/.memorymesh/stack down --volumes --remove-orphans`
    );
    expect(removed).toContain("/tmp/home/.memorymesh");
  });
});
