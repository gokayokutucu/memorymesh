import { runInteractiveCli } from "../interactive";
import { IFolderImportSummary } from "../folder-import";
import { IStyle } from "../terminal-style";

const plainStyle: IStyle = {
  heading: (text) => text,
  success: (text) => text,
  warning: (text) => text,
  error: (text) => text,
  muted: (text) => text,
  renderTitle: () => "TITLE",
};

const defaultSummary: IFolderImportSummary = {
  scannedJsonFiles: 3,
  supportedConversationFiles: 1,
  importedConversations: 1,
  savedMemories: 5,
  skippedMemories: 2,
  categories: {
    supported_conversation_file: 1,
    unsupported_conversation_schema: 1,
    ignorable_json: 1,
    unknown_json: 0,
    invalid_json: 0,
  },
  skipReasons: {},
  checkpointUsed: true,
  resumed: false,
  checkpointPath: "/tmp/checkpoint.json",
  checkpointMode: "real",
  resumeSkippedMessages: 0,
};

describe("interactive CLI", () => {
  afterEach(() => {
    delete process.env.MEMORYMESH_INTERACTIVE_DRY_RUN;
  });

  it("routes import selection with real-import defaults", async () => {
    const prompts = ["1", "/tmp/gpt-export", "Y"];
    const write = jest.fn();
    const close = jest.fn();
    const runImport = jest.fn(async () => defaultSummary);
    const prompt = jest.fn(async () => prompts.shift() ?? "");

    const code = await runInteractiveCli({
      prompt,
      write,
      close,
      runImport,
      style: plainStyle,
    });

    expect(code).toBe(0);
    expect(runImport).toHaveBeenCalledWith("/tmp/gpt-export", {
      project: "MemoryMesh",
      dryRun: false,
      engine: "rust",
      importPolicy: "skip_existing",
      verbose: false,
      delayMs: 0,
    });
    const output = write.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Select an action");
    expect(output).toContain("Import Configuration");
    expect(output).toContain("Project: MemoryMesh");
    expect(output).toContain("Mode: real import");
    expect(output).toContain("Engine: rust");
    expect(output).toContain("Import policy: skip_existing");
    expect(close).toHaveBeenCalled();
  });

  it("enables interactive dry-run when MEMORYMESH_INTERACTIVE_DRY_RUN=true", async () => {
    process.env.MEMORYMESH_INTERACTIVE_DRY_RUN = "true";
    const prompts = ["1", "/tmp/gpt-export", "Y"];
    const write = jest.fn();
    const runImport = jest.fn(async () => defaultSummary);

    const code = await runInteractiveCli({
      prompt: async () => prompts.shift() ?? "",
      write,
      close: jest.fn(),
      runImport,
      style: plainStyle,
    });

    expect(code).toBe(0);
    expect(runImport).toHaveBeenCalledWith("/tmp/gpt-export", {
      project: "MemoryMesh",
      dryRun: true,
      engine: "rust",
      importPolicy: "skip_existing",
      verbose: false,
      delayMs: 0,
    });
    const output = write.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Mode: dry-run");
  });

  it("exits when user selects exit", async () => {
    const write = jest.fn();
    const runImport = jest.fn(async () => defaultSummary);
    const code = await runInteractiveCli({
      prompt: async () => "2",
      write,
      close: jest.fn(),
      runImport,
      style: plainStyle,
    });

    expect(code).toBe(0);
    expect(runImport).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("Bye.");
  });

  it("cancels import when confirmation is n", async () => {
    const prompts = ["1", "/tmp/gpt-export", "n"];
    const write = jest.fn();
    const runImport = jest.fn(async () => defaultSummary);
    const code = await runInteractiveCli({
      prompt: async () => prompts.shift() ?? "",
      write,
      close: jest.fn(),
      runImport,
      style: plainStyle,
    });

    expect(code).toBe(0);
    expect(runImport).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("Import cancelled.");
  });
});
