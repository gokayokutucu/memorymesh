#!/usr/bin/env node

import { runImportGptCommand } from "./commands/import-gpt";
import { runInteractiveCli } from "./interactive";
import { style } from "./terminal-style";

function printMainHelp(): void {
  console.log(style.heading("MemoryMesh CLI"));
  console.log("Usage:");
  console.log("  memorymesh                     # interactive mode");
  console.log("  memorymesh import:gpt [args]   # direct command mode");
  console.log("");
  console.log("Interactive defaults:");
  console.log("  project = MemoryMesh");
  console.log("  mode = dry-run");
  console.log("  engine = rust");
  console.log("  import policy = skip_existing");
  console.log("  verbose = false");
  console.log("  delay = 0");
}

export async function runMain(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    return runInteractiveCli();
  }

  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    printMainHelp();
    return 0;
  }

  if (command === "import:gpt") {
    return runImportGptCommand(rest);
  }

  console.error(style.error(`Unknown command: ${command}`));
  printMainHelp();
  return 1;
}

async function main(): Promise<void> {
  const code = await runMain(process.argv.slice(2));
  process.exit(code);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(style.error(`MemoryMesh CLI failed: ${String(error)}`));
    process.exit(1);
  });
}
