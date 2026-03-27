import { IImportPolicy, ImportInterruptedError } from "@memorymesh/core";
import { resolve } from "node:path";
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
import {
  persistLastStartedDocumentImportPath,
  readLastStartedDocumentImportPath,
} from "./import-defaults";

export interface IImportDocumentsArgs {
  path?: string;
  project: string;
  importPolicy: IImportPolicy;
  invalidImportPolicy?: string;
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
  onImportSuccess?: (inputPath: string) => Promise<void> | void;
  readLastDocumentImportPath: (homeDir: string) => Promise<string | null>;
  pathExists: (path: string) => boolean;
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
      } else if (policy) {
        args.invalidImportPolicy = policy;
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
  const homeDir = resolveUserHomeDir(process.platform, process.env);
  const resolvedDeps: IImportDocumentsDeps = {
    importer: deps?.importer ?? importDocumentsFromPath,
    logger: deps?.logger ?? console,
    resolveEmbeddingAuthority:
      deps?.resolveEmbeddingAuthority
      ?? (() =>
        resolveAuthoritativeEmbeddingConfig(
          resolveUserHomeDir(process.platform, process.env),
          nodeFileSystem
        )),
    onImportStarted:
      deps?.onImportStarted
      ?? ((inputPath: string) =>
        persistLastStartedDocumentImportPath(homeDir, inputPath)),
    onImportSuccess: deps?.onImportSuccess,
    readLastDocumentImportPath:
      deps?.readLastDocumentImportPath ?? readLastStartedDocumentImportPath,
    pathExists: deps?.pathExists ?? nodeFileSystem.exists,
  };
  const logger = resolvedDeps.logger;
  const readLastPath = resolvedDeps.readLastDocumentImportPath;
  const pathExists = resolvedDeps.pathExists;
  if (args.help) {
    printImportDocumentsHelp(logger);
    return 0;
  }

  let inputPath = args.path?.trim() ?? "";
  if (!inputPath) {
    const storedPath = await readLastPath(homeDir);
    if (storedPath && pathExists(storedPath)) {
      inputPath = storedPath;
    }
  }

  if (!inputPath) {
    logger.error("Missing required --path argument.");
    printImportDocumentsHelp(logger);
    return 1;
  }
  if (args.invalidImportPolicy) {
    logger.error(
      `Invalid --import-policy value: ${args.invalidImportPolicy}. Use skip_existing|import_anyway|overwrite_existing.`
    );
    return 1;
  }

  try {
    const authority = await resolvedDeps.resolveEmbeddingAuthority();
    const resolvedPath = resolve(inputPath);
    const summary = await resolvedDeps.importer(resolvedPath, {
      project: args.project,
      importPolicy: args.importPolicy,
      dryRun: args.dryRun,
      checkpointEnabled: args.checkpoint,
      resetCheckpoint: args.resetCheckpoint,
      runtimeEnv: authority.runtimeEnv,
      onImportStarted: async () => {
        await resolvedDeps.onImportStarted?.(resolvedPath);
      },
    });
    await resolvedDeps.onImportSuccess?.(summary.inputPath);

    logger.log(style.heading("=== Document Import Summary ==="));
    logger.log(`Input path: ${summary.inputPath}`);
    logger.log(`Discovered files: ${summary.discoveredFiles}`);
    logger.log(`Supported files: ${summary.supportedFiles}`);
    logger.log(`Skipped files: ${summary.skippedFiles}`);
    logger.log(`Imported chunks: ${summary.importedChunks}`);
    logger.log(`Skipped chunks: ${summary.skippedChunks}`);
    const skipReasonKeys = Object.keys(summary.skipReasons);
    if (skipReasonKeys.length > 0) {
      logger.log("Skip reasons:");
      for (const key of skipReasonKeys.sort()) {
        logger.log(`  ${key}: ${summary.skipReasons[key]}`);
      }
    }
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
