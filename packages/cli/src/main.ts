#!/usr/bin/env node

import { isMemoryMeshInstalled } from "./installer/first-run";
import { runSetupWizard } from "./installer/setup-wizard";
import { resolveUserHomeDir } from "./system/runtime-home";
import { style } from "./terminal-style";

function printMainHelp(): void {
  console.log(style.heading("MemoryMesh CLI"));
  console.log("Usage:");
  console.log("  memorymesh                     # setup + interactive menu");
  console.log("  memorymesh import:gpt [args]   # direct command mode");
  console.log("  memorymesh import:documents    # direct document import mode");
  console.log("  memorymesh doctor              # service health report");
  console.log("  memorymesh doctor --fix        # run diagnostics and safe repairs");
  console.log("  memorymesh start               # start managed stack");
  console.log("  memorymesh stop                # stop managed stack");
  console.log("  memorymesh reset               # reset managed stack");
  console.log("  memorymesh uninstall           # uninstall MemoryMesh runtime");
  console.log("  memorymesh upgrade             # upgrade scaffold (safe placeholder)");
  console.log("  memorymesh mcp                 # MCP stdio bridge");
  console.log("");
}

export async function runMain(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    console.log(style.renderTitle());

    let homeDir: string;
    try {
      homeDir = resolveUserHomeDir(process.platform, process.env);
    } catch (error) {
      console.error(style.error(String(error)));
      return 1;
    }

    if (!isMemoryMeshInstalled(homeDir)) {
      const setupResult = await runSetupWizard();
      if (setupResult === "cancelled") {
        return 0;
      }
    }

    const { runRuntimeMenu } = await import("./commands/menu");
    return runRuntimeMenu();
  }

  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    printMainHelp();
    return 0;
  }

  if (command === "import:gpt") {
    const { runImportGptCommand } = await import("./commands/import-gpt");
    return runImportGptCommand(rest);
  }

  if (command === "import:documents") {
    const { runImportDocumentsCommand } = await import("./commands/import-documents");
    return runImportDocumentsCommand(rest);
  }

  if (command === "doctor") {
    const { runDoctorCommand } = await import("./commands/doctor");
    return runDoctorCommand(rest);
  }

  if (command === "start") {
    const { runStartCommand } = await import("./commands/lifecycle");
    return runStartCommand(rest);
  }

  if (command === "stop") {
    const { runStopCommand } = await import("./commands/lifecycle");
    return runStopCommand(rest);
  }

  if (command === "reset") {
    const { runResetCommand } = await import("./commands/lifecycle");
    return runResetCommand(rest);
  }

  if (command === "uninstall") {
    const { runUninstallCommand } = await import("./commands/lifecycle");
    return runUninstallCommand(rest);
  }

  if (command === "upgrade") {
    const { runUpgradeCommand } = await import("./commands/upgrade");
    return runUpgradeCommand(rest);
  }

  if (command === "mcp") {
    const { runMcpCommand } = await import("./commands/mcp");
    return runMcpCommand(rest);
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
