import { inspectDirtySetupState } from "../installer/dirty-state";
import { ICommandRunner, ICommandRunOptions, ICommandResult } from "../system/command-runner";
import { IFileSystem } from "../system/filesystem";

class FakeRunner implements ICommandRunner {
  constructor(private readonly qdrantCollectionsResponse: string | null) {}

  async run(
    command: string,
    args: string[] = [],
    _options?: ICommandRunOptions
  ): Promise<ICommandResult> {
    const key = `${command} ${args.join(" ")}`;
    if (key === "curl -fsS http://localhost:6333/collections") {
      if (!this.qdrantCollectionsResponse) {
        return {
          stdout: "",
          stderr: "down",
          exitCode: 1,
          success: false,
        };
      }
      return {
        stdout: this.qdrantCollectionsResponse,
        stderr: "",
        exitCode: 0,
        success: true,
      };
    }

    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      success: true,
    };
  }
}

function createFs(existingPaths: string[]): IFileSystem {
  const set = new Set(existingPaths);
  return {
    exists: (path: string) => set.has(path),
    mkdir: async () => {},
    read: async () => "",
    write: async () => {},
  };
}

describe("dirty-state detection", () => {
  it("detects dirty state via Qdrant collections HTTP endpoint when managed footprint exists", async () => {
    const fs = createFs([
      "/tmp/home/.memorymesh",
      "/tmp/home/.memorymesh/stack/docker-compose.yml",
    ]);
    const runner = new FakeRunner(
      JSON.stringify({
        result: {
          collections: [{ name: "memories" }],
        },
      })
    );

    const report = await inspectDirtySetupState("/tmp/home", fs, runner);

    expect(report.hasDirtyState).toBe(true);
    expect(report.signals.qdrantHasCollections).toBe(true);
    expect(report.details).toContain("Qdrant collections detected.");
  });

  it("ignores Qdrant collections when no managed footprint exists", async () => {
    const fs = createFs([]);
    const runner = new FakeRunner(
      JSON.stringify({
        result: {
          collections: [{ name: "memories" }],
        },
      })
    );

    const report = await inspectDirtySetupState("/tmp/home", fs, runner);

    expect(report.hasDirtyState).toBe(false);
    expect(report.signals.qdrantHasCollections).toBe(false);
    expect(report.details).not.toContain("Qdrant collections detected.");
  });

  it("does not crash when Qdrant HTTP is unavailable", async () => {
    const fs = createFs([]);
    const runner = new FakeRunner(null);

    const report = await inspectDirtySetupState("/tmp/home", fs, runner);

    expect(report.hasDirtyState).toBe(false);
    expect(report.signals.qdrantHasCollections).toBe(false);
  });
});
