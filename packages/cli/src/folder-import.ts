import { parseConversations, importConversations, IImportRunOptions } from "./gpt-importer";
import { JsonFileCategory } from "./json-shape-classifier";
import { scanJsonInputPath } from "./folder-scan";

export interface IFolderImportOptions extends IImportRunOptions {
  project: string;
  dryRun: boolean;
  limit?: number;
  verbose?: boolean;
}

export interface IFolderImportSummary {
  scannedJsonFiles: number;
  supportedConversationFiles: number;
  importedConversations: number;
  savedMemories: number;
  skippedMemories: number;
  categories: Record<JsonFileCategory, number>;
  skipReasons: Record<string, number>;
}

export interface IFolderImportDependencies {
  parse: typeof parseConversations;
  importer: typeof importConversations;
}

export async function importFromPath(
  inputPath: string,
  options: IFolderImportOptions,
  deps: IFolderImportDependencies = {
    parse: parseConversations,
    importer: importConversations,
  }
): Promise<IFolderImportSummary> {
  const report = scanJsonInputPath(inputPath);
  const summary: IFolderImportSummary = {
    scannedJsonFiles: report.scanned_json_files,
    supportedConversationFiles: report.counts.supported_conversation_file,
    importedConversations: 0,
    savedMemories: 0,
    skippedMemories: 0,
    categories: report.counts,
    skipReasons: {},
  };

  let remainingLimit = options.limit;

  for (const scanned of report.files) {
    if (options.verbose || options.dryRun) {
      // File-level classification log keeps folder scan transparent.
      console.log(`[scan] ${scanned.category} | ${scanned.reason} | ${scanned.path}`);
    }

    if (scanned.category !== "supported_conversation_file") {
      continue;
    }

    if (remainingLimit !== undefined && remainingLimit <= 0) {
      break;
    }

    const conversations = deps.parse(scanned.content ?? "");
    const selected =
      remainingLimit === undefined
        ? conversations
        : conversations.slice(0, remainingLimit);

    if (selected.length === 0) {
      continue;
    }

    const result = await deps.importer(selected, options.project, options.dryRun, {
      delayMs: options.delayMs,
      verbose: options.verbose,
      importPolicy: options.importPolicy,
    });

    summary.importedConversations += result.totalConversations;
    summary.savedMemories += result.saved;
    summary.skippedMemories += result.skipped;

    for (const [reason, count] of Object.entries(result.skippedReasons)) {
      summary.skipReasons[reason] = (summary.skipReasons[reason] ?? 0) + count;
    }

    if (remainingLimit !== undefined) {
      remainingLimit -= selected.length;
    }
  }

  return summary;
}
