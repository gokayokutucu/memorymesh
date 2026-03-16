import { runImportGptCommand } from "../src/commands/import-gpt";

async function main(): Promise<void> {
  const exitCode = await runImportGptCommand(process.argv.slice(2));
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`GPT import failed: ${String(error)}`);
  process.exit(1);
});
