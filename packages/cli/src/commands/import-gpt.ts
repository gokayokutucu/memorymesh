import { resolve } from "node:path";
import { IImportPolicy } from "@memorymesh/core";
import { IFolderImportSummary, importFromPath } from "../folder-import";
import { IStyle, style } from "../terminal-style";

export interface IImportGptArgs {
  path?: string;
  project: string;
  dryRun: boolean;
  delayMs: number;
  verbose: boolean;
  engine: "ts" | "rust";
  rustBinaryPath?: string;
  importPolicy: IImportPolicy;
  limit?: number;
  checkpoint: boolean;
  resetCheckpoint: boolean;
  help: boolean;
}

export interface ICommandLogger {
  log(line: string): void;
  error(line: string): void;
}

export interface IImportCommandDeps {
  importer: typeof importFromPath;
  logger: ICommandLogger;
  style: IStyle;
}

const DEFAULT_ARGS: IImportGptArgs = {
  project: "MemoryMesh",
  dryRun: false,
  delayMs: 0,
  verbose: false,
  engine: "ts",
  importPolicy: "skip_existing",
  checkpoint: true,
  resetCheckpoint: false,
  help: false,
};

export function parseImportGptArgs(argv: string[]): IImportGptArgs {
  const args: IImportGptArgs = { ...DEFAULT_ARGS };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--file" || token === "--path") {
      args.path = argv[i + 1];
      i += 1;
    } else if (token === "--project") {
      args.project = argv[i + 1] ?? "MemoryMesh";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--delay-ms") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        args.delayMs = parsed;
      }
      i += 1;
    } else if (token === "--verbose") {
      args.verbose = true;
    } else if (token === "--engine") {
      const engine = argv[i + 1];
      if (engine === "ts" || engine === "rust") {
        args.engine = engine;
      }
      i += 1;
    } else if (token === "--rust-bin") {
      args.rustBinaryPath = argv[i + 1];
      i += 1;
    } else if (token === "--import-policy") {
      const policy = argv[i + 1];
      if (
        policy === "skip_existing" ||
        policy === "overwrite_existing" ||
        policy === "import_anyway"
      ) {
        args.importPolicy = policy;
      }
      i += 1;
    } else if (token === "--limit") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        args.limit = parsed;
      }
      i += 1;
    } else if (token === "--no-checkpoint") {
      args.checkpoint = false;
    } else if (token === "--reset-checkpoint") {
      args.resetCheckpoint = true;
    }
  }

  return args;
}

export function printImportGptHelp(
  logger: ICommandLogger = console,
  theme: IStyle = style
): void {
  logger.log(theme.heading("MemoryMesh Import Command"));
  logger.log("");
  logger.log("Import GPT export conversations into MemoryMesh.");
  logger.log(
    "Scans a file or folder, detects supported conversation JSON files,"
  );
  logger.log("and imports them into the MemoryMesh long-term memory store.");
  logger.log("");
  logger.log(theme.heading("Usage:"));
  logger.log("  memorymesh import:gpt --path <file-or-folder> [options]");
  logger.log("");
  logger.log(theme.heading("Options:"));
  logger.log("--path <path>");
  logger.log("  Path to a GPT export file or folder containing GPT export JSON files.");
  logger.log("");
  logger.log("--project <name>");
  logger.log("  Logical project namespace for imported memories.");
  logger.log("");
  logger.log("--dry-run");
  logger.log("  Simulate the import without writing anything to storage.");
  logger.log("");
  logger.log("--engine <ts|rust>");
  logger.log("  Select importer engine.");
  logger.log("  rust is recommended for large exports.");
  logger.log("");
  logger.log("--import-policy <skip_existing|import_anyway|overwrite_existing>");
  logger.log("");
  logger.log("--delay-ms <n>");
  logger.log("  Delay between conversation imports.");
  logger.log("");
  logger.log("--limit <n>");
  logger.log("  Import only the first N conversations.");
  logger.log("");
  logger.log("--no-checkpoint");
  logger.log("  Disable checkpoint load/save for this run.");
  logger.log("");
  logger.log("--reset-checkpoint");
  logger.log("  Clear and recreate checkpoint state before import.");
  logger.log("");
  logger.log("--verbose");
  logger.log("  Enable detailed per-message logs.");
  logger.log("");
  logger.log("--rust-bin <path>");
  logger.log("  Custom path to the Rust importer binary.");
  logger.log("");
  logger.log("--file <path>");
  logger.log("  Alias for --path.");
  logger.log("");
  logger.log("--help");
  logger.log("  Show this help message.");
  logger.log("");
  logger.log(theme.heading("Interactive mode defaults:"));
  logger.log("memorymesh");
  logger.log("  Project: MemoryMesh");
  logger.log("  Mode: real import (default)");
  logger.log("  Engine: rust");
  logger.log("  Import policy: skip_existing");
  logger.log("  Verbose: false");
  logger.log("  Delay: 0");
  logger.log("Set MEMORYMESH_INTERACTIVE_DRY_RUN=true to force interactive dry-run.");
  logger.log("");
  logger.log(theme.heading("Defaults:"));
  logger.log("project: MemoryMesh");
  logger.log("engine: ts");
  logger.log("import policy: skip_existing");
  logger.log("checkpoint: enabled");
  logger.log("reset checkpoint: false");
  logger.log("verbose: false");
  logger.log("delay: 0");
  logger.log("");
  logger.log(theme.heading("Import policy behavior:"));
  logger.log("skip_existing");
  logger.log("  Supported. Default behavior.");
  logger.log("");
  logger.log("import_anyway");
  logger.log("  Supported. Imports even if similar memory exists.");
  logger.log("");
  logger.log("overwrite_existing");
  logger.log("  Not fully implemented across all stores.");
  logger.log("  Currently results in skip reason:");
  logger.log("  overwrite_existing_not_supported");
  logger.log("");
  logger.log(theme.heading("Output behavior:"));
  logger.log("The importer runs in quiet mode by default.");
  logger.log("It shows only:");
  logger.log("• scan summary");
  logger.log("• conversation progress bar");
  logger.log("• final import summary");
  logger.log("");
  logger.log("To see detailed per-message decisions use:");
  logger.log("--verbose");
  logger.log("");
  logger.log(theme.heading("Examples:"));
  logger.log("Dry run on a GPT export folder:");
  logger.log("memorymesh import:gpt --path ./gpt-export --dry-run");
  logger.log("");
  logger.log("Use the Rust engine:");
  logger.log("memorymesh import:gpt --path ./gpt-export --engine rust");
  logger.log("");
  logger.log("Verbose import with custom project:");
  logger.log("memorymesh import:gpt \\");
  logger.log("  --path ./gpt-export \\");
  logger.log("  --project ResearchNotes \\");
  logger.log("  --import-policy import_anyway \\");
  logger.log("  --verbose");
  logger.log(
    theme.muted(
      "Progress note: the CLI shows a conversation-level progress bar during import and dry-run execution."
    )
  );
}

export function printImportSummary(
  result: IFolderImportSummary,
  logger: ICommandLogger = console,
  theme: IStyle = style
): void {
  const reasons = Object.entries(result.skipReasons)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");

  logger.log(theme.heading("=== Folder Import Summary ==="));
  logger.log(`Scanned JSON files: ${result.scannedJsonFiles}`);
  logger.log(`Supported conversation files: ${result.supportedConversationFiles}`);
  logger.log(`Imported conversations: ${result.importedConversations}`);
  logger.log(`Saved memories: ${result.savedMemories}`);
  logger.log(`Skipped memories: ${result.skippedMemories}`);
  logger.log(`ignorable_json: ${result.categories.ignorable_json}`);
  logger.log(
    `unsupported_conversation_schema: ${result.categories.unsupported_conversation_schema}`
  );
  logger.log(`unknown_json: ${result.categories.unknown_json}`);
  logger.log(`invalid_json: ${result.categories.invalid_json}`);
  logger.log(`Checkpoint used: ${result.checkpointUsed ? "yes" : "no"}`);
  logger.log(`Resumed: ${result.resumed ? "yes" : "no"}`);
  logger.log(`Checkpoint mode: ${result.checkpointMode}`);
  if (result.checkpointPath) {
    logger.log(`Checkpoint path: ${result.checkpointPath}`);
  }
  logger.log(`Resume-skipped messages: ${result.resumeSkippedMessages}`);
  if (reasons) {
    logger.log(`Skip reasons: ${reasons}`);
  }
}

export async function runImportGptCommand(
  argv: string[],
  deps: Partial<IImportCommandDeps> = {}
): Promise<number> {
  const resolvedDeps: IImportCommandDeps = {
    importer: deps.importer ?? importFromPath,
    logger: deps.logger ?? console,
    style: deps.style ?? style,
  };

  const args = parseImportGptArgs(argv);
  if (args.help || !args.path) {
    printImportGptHelp(resolvedDeps.logger, resolvedDeps.style);
    return args.help ? 0 : 1;
  }

  try {
    const result = await resolvedDeps.importer(resolve(args.path), {
      project: args.project,
      dryRun: args.dryRun,
      limit: args.limit,
      delayMs: args.delayMs,
      verbose: args.verbose,
      engine: args.engine,
      rustBinaryPath: args.rustBinaryPath,
      importPolicy: args.importPolicy,
      checkpointEnabled: args.checkpoint,
      resetCheckpoint: args.resetCheckpoint,
    });
    printImportSummary(result, resolvedDeps.logger, resolvedDeps.style);
    return 0;
  } catch (error) {
    resolvedDeps.logger.error(
      resolvedDeps.style.error(`GPT import failed: ${String(error)}`)
    );
    return 1;
  }
}
