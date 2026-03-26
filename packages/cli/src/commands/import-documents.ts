import { IImportPolicy, ImportInterruptedError } from "@memorymesh/core";
import {
  IDocumentImportSummary,
  importDocumentsFromPath,
} from "../document-import";
import { style } from "../terminal-style";
import {
  IResolvedAuthority,
  resolveAuthoritativeEmbeddingConfig,
} from "../installer/embedding-authority";
import { nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";

export interface IImportDocumentsArgs {
  path?: string;
  project: string;
  importPolicy: IImportPolicy;
  dryRun: boolean;
  checkpoint: boolean;
  resetCheckpoint: boolean;
  help: boolean;
}

export interface IImportDocumentsDeps {
  importer: (inputPath: string, options: {
    project: string;
    importPolicy: IImportPolicy;
    dryRun: boolean;
    checkpointEnabled: boolean;
    resetCheckpoint: boolean;
    runtimeEnv: NodeJS.ProcessEnv;
    onImportStarted?: () => Promise<void> | void;
  }) => Promise<IDocumentImportSummary>;
  logger: {
    log(line: string): void;
    error(line: string): void;
  };
  resolveEmbeddingAuthority: () => Promise<IResolvedAuthority>;
  onImportStarted?: (inputPath: string) => Promise<void> | void;
}

const DEFAULT_ARGS: IImportDocumentsArgs = {
  project: "MemoryMesh",
  importPolicy: "skip_existing",
  dryRun: false,
  checkpoint: true,
  resetCheckpoint: false,
  help: false,
};

export function parseImportDocumentsArgs(argv: string[]): IImportDocumentsArgs {
  const args: IImportDocumentsArgs = { ...DEFAULT_ARGS };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--path" || token === "--file") {
      args.path = argv[i + 1];
      i += 1;
    } else if (token === "--project") {
      args.project = argv[i + 1] ?? "MemoryMesh";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--import-policy") {
      const policy = argv[i + 1];
      if (
        policy === "skip_existing" ||
        policy === "import_anyway" ||
        policy === "overwrite_existing"
      ) {
        args.importPolicy = policy;
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

export function printImportDocumentsHelp(logger: { log(line: string): void } = console): void {
  logger.log(style.heading("MemoryMesh Document Import"));
  logger.log("");
  logger.log("Usage:");
  logger.log("  memorymesh import:documents --path <file-or-folder> [options]");
  logger.log("");
  logger.log("Options:");
  logger.log("  --path <path>");
  logger.log("  --project <name>");
  logger.log("  --import-policy <skip_existing|import_anyway|overwrite_existing>");
  logger.log("  --dry-run");
  logger.log("  --no-checkpoint");
  logger.log("  --reset-checkpoint");
  logger.log("  --help");
}

export async function runImportDocumentsCommand(
  argv: string[],
  deps?: Partial<IImportDocumentsDeps>
): Promise<number> {
  const args = parseImportDocumentsArgs(argv);
  const logger = deps?.logger ?? console;
  if (args.help) {
    printImportDocumentsHelp(logger);
    return 0;
  }

  if (!args.path) {
    logger.error("Missing required --path argument.");
    printImportDocumentsHelp(logger);
    return 1;
  }

  const importer = deps?.importer ?? importDocumentsFromPath;
  const resolveEmbeddingAuthority =
    deps?.resolveEmbeddingAuthority
      ?? (() =>
        resolveAuthoritativeEmbeddingConfig(
          resolveUserHomeDir(process.platform, process.env),
          nodeFileSystem
        ));

  try {
    const resolvedPath = args.path;
    const authority = await resolveEmbeddingAuthority();
    const summary = await importer(resolvedPath, {
      project: args.project,
      importPolicy: args.importPolicy,
      dryRun: args.dryRun,
      checkpointEnabled: args.checkpoint,
      resetCheckpoint: args.resetCheckpoint,
      runtimeEnv: authority.runtimeEnv,
      onImportStarted: async () => {
        await deps?.onImportStarted?.(resolvedPath);
      },
    });

    logger.log(style.heading("=== Document Import Summary ==="));
    logger.log(`Input path: ${summary.inputPath}`);
    logger.log(`Discovered files: ${summary.discoveredFiles}`);
    logger.log(`Supported files: ${summary.supportedFiles}`);
    logger.log(`Skipped files: ${summary.skippedFiles}`);
    logger.log(`Imported chunks: ${summary.importedChunks}`);
    logger.log(`Skipped chunks: ${summary.skippedChunks}`);
    logger.log(`Checkpoint used: ${summary.checkpointUsed ? "yes" : "no"}`);
    logger.log(`Resumed: ${summary.resumed ? "yes" : "no"}`);
    if (summary.checkpointPath) {
      logger.log(`Checkpoint path: ${summary.checkpointPath}`);
    }
    if (summary.auditLogPath) {
      logger.log(`Audit log: ${summary.auditLogPath}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ImportInterruptedError) {
      logger.error("Document import interrupted.");
      return 130;
    }

    logger.error(`Document import failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
