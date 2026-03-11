import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  importConversations,
  parseConversations,
} from "../src/gpt-importer";

interface IArgs {
  file?: string;
  project: string;
  dryRun: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): IArgs {
  const args: IArgs = {
    project: "general",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[i + 1];
      i += 1;
    } else if (token === "--project") {
      args.project = argv[i + 1] ?? "general";
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
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
  if (!args.file) {
    console.error("Usage: ts-node scripts/gpt-import.ts --file <path> [--project <name>] [--dry-run] [--limit <n>]");
    process.exit(1);
  }

  const filePath = resolve(args.file);
  const raw = readFileSync(filePath, "utf-8");
  const conversations = parseConversations(raw);
  const limited = args.limit ? conversations.slice(0, args.limit) : conversations;

  const result = await importConversations(limited, args.project, args.dryRun);
  console.log(`Import complete. Saved: ${result.saved}, Skipped: ${result.skipped}`);
}

main().catch((error) => {
  console.error("GPT import failed:", error);
  process.exit(1);
});
