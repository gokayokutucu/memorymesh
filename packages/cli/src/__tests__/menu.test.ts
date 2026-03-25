jest.mock("../commands/doctor", () => ({
  runDoctorCommand: jest.fn(),
}));

jest.mock("../commands/import-gpt", () => ({
  runImportGptCommand: jest.fn(),
}));

jest.mock("../commands/mcp", () => ({
  runMcpCommand: jest.fn(),
}));

jest.mock("../commands/search", () => ({
  runSearchCommand: jest.fn(),
}));

jest.mock("../installer/first-run", () => ({
  readInstallConfig: jest.fn(),
  persistInstallConfig: jest.fn(),
}));

jest.mock("../installer/runtime-config", () => ({
  readInstallerRuntimeEnv: jest.fn(),
  writeInstallerRuntimeEnv: jest.fn(),
  mapEmbeddingModeToDimension: (mode: "flash" | "medium") =>
    mode === "flash" ? 768 : 1024,
}));

import { runRuntimeMenu } from "../commands/menu";
import { runDoctorCommand } from "../commands/doctor";
import { runImportGptCommand } from "../commands/import-gpt";
import { runMcpCommand } from "../commands/mcp";
import { runSearchCommand } from "../commands/search";
import { persistInstallConfig, readInstallConfig } from "../installer/first-run";
import { readInstallerRuntimeEnv, writeInstallerRuntimeEnv } from "../installer/runtime-config";
import { IRuntimeMenuUi, RuntimeAction } from "../ui/runtime-menu";
import { ICommandRunner } from "../system/command-runner";
import { IRuntimeTextPromptOptions, PromptInputOptions, PromptResult } from "../ui/runtime-menu";

class FakeUi implements IRuntimeMenuUi {
  notes: string[] = [];
  promptMessages: string[] = [];
  promptPlaceholders: string[] = [];
  promptTabCycleValues: string[][] = [];

  constructor(
    private readonly actions: RuntimeAction[],
    private readonly textAnswers: Array<string | null | undefined> = [],
    private readonly embeddingSelections: Array<"flash" | "medium" | null> = []
  ) {}

  async intro(_title: string): Promise<void> {}
  async outro(message: string): Promise<void> {
    this.notes.push(message);
  }
  async note(message: string): Promise<void> {
    this.notes.push(message);
  }
  async selectAction(): Promise<RuntimeAction | null> {
    return this.actions.shift() ?? "exit";
  }
  async promptInput(options: PromptInputOptions): Promise<PromptResult> {
    this.promptMessages.push(options.label);
    this.promptPlaceholders.push(options.placeholder ?? "");
    this.promptTabCycleValues.push([...(options.tabCycleValues ?? [])]);
    if (this.textAnswers.length === 0) {
      return { status: "cancel" };
    }

    const raw = this.textAnswers.shift();
    if (raw === null) {
      return { status: "cancel" };
    }
    if (typeof raw !== "string") {
      return { status: "retry" };
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      if (options.required) {
        return { status: "retry" };
      }
      return {
        status: "submit",
        value: options.defaultValue ?? "",
      };
    }

    return {
      status: "submit",
      value: trimmed,
    };
  }
  async promptText(
    message: string,
    placeholder?: string,
    options?: IRuntimeTextPromptOptions
  ): Promise<string | null> {
    const result = await this.promptInput({
      label: message,
      placeholder,
      tabCycleValues: options?.tabCycleValues,
      required: false,
      loop: false,
    });
    if (result.status === "cancel") {
      return null;
    }
    if (result.status === "retry") {
      return "";
    }
    return result.value;
  }
  async selectEmbeddingMode(): Promise<"flash" | "medium" | null> {
    return this.embeddingSelections.shift() ?? null;
  }
}

class NoopRunner implements ICommandRunner {
  async run(): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      success: true,
    };
  }
}

const mockedRunDoctorCommand = runDoctorCommand as jest.MockedFunction<
  typeof runDoctorCommand
>;
const mockedRunImportGptCommand = runImportGptCommand as jest.MockedFunction<
  typeof runImportGptCommand
>;
const mockedRunMcpCommand = runMcpCommand as jest.MockedFunction<typeof runMcpCommand>;
const mockedRunSearchCommand = runSearchCommand as jest.MockedFunction<typeof runSearchCommand>;
const mockedReadInstallConfig = readInstallConfig as jest.MockedFunction<
  typeof readInstallConfig
>;
const mockedPersistInstallConfig = persistInstallConfig as jest.MockedFunction<
  typeof persistInstallConfig
>;
const mockedReadInstallerRuntimeEnv =
  readInstallerRuntimeEnv as jest.MockedFunction<typeof readInstallerRuntimeEnv>;
const mockedWriteInstallerRuntimeEnv =
  writeInstallerRuntimeEnv as jest.MockedFunction<typeof writeInstallerRuntimeEnv>;

describe("runtime menu", () => {
  const mockedReadLastImportPath = jest.fn<Promise<string | null>, [string]>();
  const mockedPersistLastImportPath = jest.fn<Promise<void>, [string, string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunDoctorCommand.mockResolvedValue(0);
    mockedRunImportGptCommand.mockResolvedValue(0);
    mockedRunMcpCommand.mockResolvedValue(0);
    mockedRunSearchCommand.mockResolvedValue({
      ok: true,
      message: "Search completed.",
      results: [],
    });
    mockedReadInstallConfig.mockResolvedValue({
      installState: "installed",
      embeddingMode: "flash",
      embeddingModel: "nomic-embed-text",
      embeddingDimension: 768,
      installedAt: "2026-03-16T00:00:00.000Z",
      stackProjectDir: "/tmp/home/.memorymesh/stack",
      composeFilePath: "/tmp/home/.memorymesh/stack/docker-compose.yml",
    });
    mockedPersistInstallConfig.mockResolvedValue();
    mockedReadInstallerRuntimeEnv.mockResolvedValue({
      EMBEDDING_MODEL: "nomic-embed-text",
      MEMORYMESH_EMBEDDING_DIMENSION: "768",
    });
    mockedWriteInstallerRuntimeEnv.mockResolvedValue("/tmp/home/.memorymesh/runtime.env");
    mockedReadLastImportPath.mockResolvedValue(null);
    mockedPersistLastImportPath.mockResolvedValue();
  });

  it("gracefully exits", async () => {
    const ui = new FakeUi(["exit"]);
    const code = await runRuntimeMenu({ ui, runner: new NoopRunner() });
    expect(code).toBe(0);
    expect(ui.notes).toContain("Bye.");
  });

  it("uses auto-detected import path without prompting for path", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], ["", "", ""]);
    const detectImportPath = jest
      .fn<Promise<string | null>, [string]>()
      .mockResolvedValue("/tmp/home/Downloads/latest-export.json");

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(detectImportPath).toHaveBeenCalledWith("/tmp/home");
    expect(mockedRunImportGptCommand).toHaveBeenCalledWith([
      "--path",
      "/tmp/home/Downloads/latest-export.json",
      "--project",
      "MemoryMesh",
      "--engine",
      "rust",
      "--import-policy",
      "skip_existing",
    ], expect.objectContaining({
      onImportStarted: expect.any(Function),
    }));
  });

  it("falls back to prompt path and expands home", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], ["~/Downloads/export.json", "", "", ""]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.promptMessages[0]).toBe("Path to ChatGPT export file/folder");
    expect(ui.promptPlaceholders[0]).toBe("~/Downloads/chatgpt-export.json");
    expect(mockedRunImportGptCommand).toHaveBeenCalledWith([
      "--path",
      "/tmp/home/Downloads/export.json",
      "--project",
      "MemoryMesh",
      "--engine",
      "rust",
      "--import-policy",
      "skip_existing",
    ], expect.objectContaining({
      onImportStarted: expect.any(Function),
    }));
  });

  it("uses last started import path as prompt placeholder when available", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], ["/tmp/home/Downloads/new-export.json", "", "", ""]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);
    mockedReadLastImportPath.mockResolvedValue("/tmp/home/Downloads/last-started.zip");

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.promptMessages[0]).toBe("Path to ChatGPT export file/folder (Tab to accept)");
    expect(ui.promptPlaceholders[0]).toBe("/tmp/home/Downloads/last-started.zip");
    expect(ui.promptTabCycleValues[0]).toEqual(["/tmp/home/Downloads/last-started.zip"]);
  });

  it("configures tab-cycle options for engine and import policy prompts", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], [
      "~/Downloads/export.json",
      "",
      "",
      "",
    ]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.promptMessages).toEqual([
      "Path to ChatGPT export file/folder",
      "Project (default: MemoryMesh)",
      "Engine (ts|rust, default: rust)",
      "Import policy (skip_existing|import_anyway|overwrite_existing, default: skip_existing)",
    ]);
    expect(ui.promptTabCycleValues[2]).toEqual(["rust", "ts"]);
    expect(ui.promptTabCycleValues[3]).toEqual([
      "skip_existing",
      "import_anyway",
      "overwrite_existing",
    ]);
  });

  it("re-prompts path on empty input and does not treat empty enter as cancel", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], [
      "   ",
      "/tmp/home/Downloads/final.json",
      "",
      "",
      "",
    ]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.promptMessages.filter((message) => message === "Path to ChatGPT export file/folder"))
      .toHaveLength(2);
    expect(ui.notes).not.toContain("Import cancelled.");
    expect(mockedRunImportGptCommand).toHaveBeenCalledTimes(1);
  });

  it("cancels import only when path prompt is cancelled", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], [null]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.notes).toContain("Import cancelled.");
    expect(mockedRunImportGptCommand).not.toHaveBeenCalled();
  });

  it("cancels entire import flow when engine prompt is cancelled", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], [
      "/tmp/home/Downloads/final.json",
      "MemoryMesh",
      null,
    ]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.notes).toContain("Import cancelled.");
    expect(mockedRunImportGptCommand).not.toHaveBeenCalled();
  });

  it("cancels entire import flow when import policy prompt is cancelled", async () => {
    const ui = new FakeUi(["import_chatgpt", "exit"], [
      "/tmp/home/Downloads/final.json",
      "MemoryMesh",
      "rust",
      null,
    ]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(ui.notes).toContain("Import cancelled.");
    expect(mockedRunImportGptCommand).not.toHaveBeenCalled();
  });

  it("persists path only after import start milestone", async () => {
    const ui = new FakeUi(["import_chatgpt", "import_chatgpt", "import_chatgpt", "exit"], [
      null,
      "   ",
      "/tmp/home/Downloads/final.json",
      "",
      "",
      "",
    ]);
    const detectImportPath = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);
    mockedRunImportGptCommand.mockImplementation(async (_argv, deps) => {
      await deps?.onImportStarted?.("/tmp/home/Downloads/final.json");
      return 1;
    });

    await runRuntimeMenu({
      ui,
      runner: new NoopRunner(),
      homeDir: "/tmp/home",
      detectImportPath,
      readLastImportPath: mockedReadLastImportPath,
      persistLastImportPath: mockedPersistLastImportPath,
    });

    expect(mockedRunImportGptCommand).toHaveBeenCalledTimes(1);
    expect(mockedPersistLastImportPath).toHaveBeenCalledTimes(1);
    expect(mockedPersistLastImportPath).toHaveBeenCalledWith(
      "/tmp/home",
      "/tmp/home/Downloads/final.json"
    );
  });

  it("keeps search mode in a loop after successful search", async () => {
    const ui = new FakeUi(["search_memories", "exit"], ["release notes", "roadmap", null]);
    mockedRunSearchCommand.mockResolvedValue({
      ok: true,
      message: "Search completed.",
      results: [{ snippet: "Memory snippet", source: "chatgpt" }],
    });

    await runRuntimeMenu({ ui, runner: new NoopRunner() });

    expect(mockedRunSearchCommand).toHaveBeenNthCalledWith(1, ["--query", "release notes"]);
    expect(mockedRunSearchCommand).toHaveBeenNthCalledWith(2, ["--query", "roadmap"]);
    expect(mockedRunSearchCommand).toHaveBeenCalledTimes(2);
    expect(ui.promptMessages).toEqual([
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
    ]);
    expect(ui.notes.some((note) => note.includes("source=chatgpt"))).toBe(true);
  });

  it("keeps search mode in loop after no-result response", async () => {
    const ui = new FakeUi(["search_memories", "exit"], ["release notes", "next query", null]);
    mockedRunSearchCommand
      .mockResolvedValueOnce({
        ok: true,
        message: "Search completed.",
        results: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Search completed.",
        results: [{ snippet: "Found later", source: "chatgpt" }],
      });

    await runRuntimeMenu({ ui, runner: new NoopRunner() });

    expect(mockedRunSearchCommand).toHaveBeenCalledTimes(2);
    expect(ui.notes.some((note) => note.includes('No memories found for "release notes"'))).toBe(
      true
    );
  });

  it("keeps search mode in loop after handled search error", async () => {
    const ui = new FakeUi(["search_memories", "exit"], ["release notes", "retry query", null]);
    mockedRunSearchCommand
      .mockResolvedValueOnce({
        ok: false,
        message: "Search failed. Ensure MemoryMesh runtime services are running.",
        results: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        message: "Search completed.",
        results: [{ snippet: "Recovered", source: "chatgpt" }],
      });

    await runRuntimeMenu({ ui, runner: new NoopRunner() });

    expect(mockedRunSearchCommand).toHaveBeenCalledTimes(2);
    expect(ui.notes.some((note) => note.includes("Search failed"))).toBe(true);
  });

  it("re-prompts for empty-string search input and does not run search", async () => {
    const ui = new FakeUi(["search_memories", "exit"], ["   ", "release notes", null]);
    mockedRunSearchCommand.mockResolvedValue({
      ok: true,
      message: "Search completed.",
      results: [{ snippet: "Memory snippet", source: "chatgpt" }],
    });

    await runRuntimeMenu({ ui, runner: new NoopRunner() });

    expect(mockedRunSearchCommand).toHaveBeenCalledTimes(1);
    expect(mockedRunSearchCommand).toHaveBeenCalledWith(["--query", "release notes"]);
    expect(ui.promptMessages).toEqual([
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
    ]);
  });

  it("re-prompts for undefined search input and does not crash", async () => {
    const ui = new FakeUi(["search_memories", "exit"], [undefined, "release notes", null]);
    mockedRunSearchCommand.mockResolvedValue({
      ok: true,
      message: "Search completed.",
      results: [{ snippet: "Memory snippet", source: "chatgpt" }],
    });

    await runRuntimeMenu({ ui, runner: new NoopRunner() });

    expect(mockedRunSearchCommand).toHaveBeenCalledTimes(1);
    expect(mockedRunSearchCommand).toHaveBeenCalledWith(["--query", "release notes"]);
    expect(ui.promptMessages).toEqual([
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
      "Search query (Ctrl+C to return to menu)",
    ]);
  });

  it("exits search mode on cancelled prompt and returns to main menu", async () => {
    const ui = new FakeUi(["search_memories", "doctor", "exit"], [null]);
    await runRuntimeMenu({ ui, runner: new NoopRunner() });
    expect(mockedRunSearchCommand).not.toHaveBeenCalled();
    expect(mockedRunDoctorCommand).toHaveBeenCalledWith([], {
      runner: expect.any(NoopRunner),
    });
  });

  it("keeps main menu usable after leaving search mode", async () => {
    const ui = new FakeUi(["search_memories", "start_mcp_server", "exit"], [null]);
    await runRuntimeMenu({ ui, runner: new NoopRunner() });
    expect(mockedRunMcpCommand).toHaveBeenCalledWith([], {
      runner: expect.any(NoopRunner),
    });
  });

  it("updates settings via embedding select and persists flash|medium", async () => {
    const ui = new FakeUi(["settings", "exit"], [], ["medium"]);

    await runRuntimeMenu({ ui, runner: new NoopRunner(), homeDir: "/tmp/home" });

    expect(mockedPersistInstallConfig).toHaveBeenCalledWith(
      "/tmp/home",
      expect.objectContaining({
        embeddingMode: "medium",
        embeddingModel: "mxbai-embed-large",
        embeddingDimension: 1024,
      }),
      expect.anything()
    );
    expect(mockedWriteInstallerRuntimeEnv).toHaveBeenCalled();
    expect(ui.notes.some((note) => note.includes("Settings saved"))).toBe(true);
  });

  it("applies no settings changes when selection is unchanged", async () => {
    const ui = new FakeUi(["settings", "exit"], [], ["flash"]);
    await runRuntimeMenu({ ui, runner: new NoopRunner(), homeDir: "/tmp/home" });
    expect(mockedPersistInstallConfig).not.toHaveBeenCalled();
    expect(ui.notes.some((note) => note.includes("No settings changes applied"))).toBe(true);
  });

  it("keeps doctor wiring", async () => {
    const ui = new FakeUi(["doctor", "exit"]);
    await runRuntimeMenu({ ui, runner: new NoopRunner() });
    expect(mockedRunDoctorCommand).toHaveBeenCalledWith([], {
      runner: expect.any(NoopRunner),
    });
  });

  it("keeps mcp wiring", async () => {
    const ui = new FakeUi(["start_mcp_server", "exit"]);
    await runRuntimeMenu({ ui, runner: new NoopRunner() });
    expect(mockedRunMcpCommand).toHaveBeenCalledWith([], {
      runner: expect.any(NoopRunner),
    });
  });
});
