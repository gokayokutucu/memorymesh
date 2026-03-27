import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { IFolderImportSummary, importFromPath } from "./folder-import";
import { IStyle, style } from "./terminal-style";
import { printImportSummary } from "./commands/import-gpt";

export interface IInteractiveDeps {
  prompt(question: string): Promise<string>;
  write(line: string): void;
  close(): void;
  runImport(
    path: string,
    options: {
      project: string;
      dryRun: boolean;
      engine: "ts" | "rust";
      importPolicy: "skip_existing";
      verbose: boolean;
      delayMs: number;
    }
  ): Promise<IFolderImportSummary>;
  style: IStyle;
}

function isEnvTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function createNodeDeps(): IInteractiveDeps {
  const rl = createInterface({ input, output });
  return {
    async prompt(question: string): Promise<string> {
      return rl.question(question);
    },
    write(line: string): void {
      console.log(line);
    },
    close(): void {
      rl.close();
    },
    async runImport(path, options): Promise<IFolderImportSummary> {
      return importFromPath(resolve(path), options);
    },
    style,
  };
}

export async function runInteractiveCli(
  deps: Partial<IInteractiveDeps> = {}
): Promise<number> {
  const nodeDeps =
    deps.prompt &&
    deps.write &&
    deps.close &&
    deps.runImport &&
    deps.style
      ? undefined
      : createNodeDeps();
  const resolvedDeps: IInteractiveDeps = {
    prompt: deps.prompt ?? nodeDeps!.prompt,
    write: deps.write ?? nodeDeps!.write,
    close: deps.close ?? nodeDeps!.close,
    runImport: deps.runImport ?? nodeDeps!.runImport,
    style: deps.style ?? nodeDeps!.style,
  };

  try {
    resolvedDeps.write(resolvedDeps.style.renderTitle());
    resolvedDeps.write("");
    resolvedDeps.write(resolvedDeps.style.heading("Select an action"));
    resolvedDeps.write("1) Import GPT export");
    resolvedDeps.write("2) Exit");

    const action = (await resolvedDeps.prompt("> ")).trim();
    if (action === "2") {
      resolvedDeps.write(resolvedDeps.style.success("Bye."));
      return 0;
    }

    if (action !== "1") {
      resolvedDeps.write(resolvedDeps.style.warning("Invalid selection."));
      return 1;
    }

    const path = (await resolvedDeps.prompt("Which path do you want to scan? ")).trim();
    if (!path) {
      resolvedDeps.write(resolvedDeps.style.warning("Path is required."));
      return 1;
    }

    const defaults = {
      project: "MemoryMesh",
      dryRun: isEnvTrue(process.env.MEMORYMESH_INTERACTIVE_DRY_RUN),
      engine: "rust" as const,
      importPolicy: "skip_existing" as const,
      verbose: false,
      delayMs: 0,
    };

    resolvedDeps.write("");
    resolvedDeps.write(resolvedDeps.style.heading("Import Configuration"));
    resolvedDeps.write(`Path: ${path}`);
    resolvedDeps.write(`Project: ${defaults.project}`);
    resolvedDeps.write(
      `Mode: ${defaults.dryRun ? "dry-run" : "real import"}`
    );
    resolvedDeps.write(`Engine: ${defaults.engine}`);
    resolvedDeps.write(`Import policy: ${defaults.importPolicy}`);

    const confirmation = (await resolvedDeps.prompt("Start import? (Y/n) ")).trim();
    if (confirmation.toLowerCase() === "n") {
      resolvedDeps.write(resolvedDeps.style.warning("Import cancelled."));
      return 0;
    }

    const result = await resolvedDeps.runImport(path, defaults);
    resolvedDeps.write("");
    printImportSummary(result, {
      log: resolvedDeps.write,
      error: resolvedDeps.write,
    }, resolvedDeps.style);
    resolvedDeps.write(resolvedDeps.style.success("Import flow completed."));
    return 0;
  } catch (error) {
    resolvedDeps.write(resolvedDeps.style.error(`Interactive mode failed: ${String(error)}`));
    return 1;
  } finally {
    resolvedDeps.close();
  }
}
