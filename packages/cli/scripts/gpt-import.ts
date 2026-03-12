import { resolve } from "node:path";
import { IImportPolicy } from "@memorymesh/core";
import { importFromPath } from "../src/folder-import";

interface IArgs {
  path?: string;
  project: string;
  dryRun: boolean;
  delayMs: number;
  verbose: boolean;
  importPolicy: IImportPolicy;
  limit?: number;
}

function parseArgs(argv: string[]): IArgs {
  const args: IArgs = {
    project: "general",
    dryRun: false,
    delayMs: 3000,
    verbose: false,
    importPolicy: "skip_existing",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file" || token === "--path") {
      args.path = argv[i + 1];
      i += 1;
    } else if (token === "--project") {
      args.project = argv[i + 1] ?? "general";
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
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path) {
    console.error("Usage: ts-node scripts/gpt-import.ts --path <file-or-folder> [--project <name>] [--dry-run] [--delay-ms <n>] [--verbose] [--import-policy <skip_existing|overwrite_existing|import_anyway>] [--limit <n>]");
    console.error("Alias: --file <file-or-folder>");
    console.error("Policy note: supported today -> skip_existing, import_anyway. overwrite_existing currently returns skip reason overwrite_existing_not_supported.");
    process.exit(1);
  }

  const inputPath = resolve(args.path);
  const result = await importFromPath(inputPath, {
    project: args.project,
    dryRun: args.dryRun,
    limit: args.limit,
    delayMs: args.delayMs,
    verbose: args.verbose,
    importPolicy: args.importPolicy,
  });

  const reasons = Object.entries(result.skipReasons)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");

  console.log("=== Folder Import Summary ===");
  console.log(`Scanned JSON files: ${result.scannedJsonFiles}`);
  console.log(`Supported conversation files: ${result.supportedConversationFiles}`);
  console.log(`Imported conversations: ${result.importedConversations}`);
  console.log(`Saved memories: ${result.savedMemories}`);
  console.log(`Skipped memories: ${result.skippedMemories}`);
  console.log(`ignorable_json: ${result.categories.ignorable_json}`);
  console.log(
    `unsupported_conversation_schema: ${result.categories.unsupported_conversation_schema}`
  );
  console.log(`unknown_json: ${result.categories.unknown_json}`);
  console.log(`invalid_json: ${result.categories.invalid_json}`);
  if (reasons) {
    console.log(`Skip reasons: ${reasons}`);
  }
}

main().catch((error) => {
  console.error("GPT import failed:", error);
  process.exit(1);
});
