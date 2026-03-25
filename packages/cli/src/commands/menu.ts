import {
  detectLatestChatGptExportPath,
  expandHomePath,
  persistLastStartedChatGptImportPath,
  readLastStartedChatGptImportPath,
} from "./import-defaults";
import { runDoctorCommand } from "./doctor";
import { runMcpCommand } from "./mcp";
import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import { persistInstallConfig, readInstallConfig } from "../installer/first-run";
import {
  mapEmbeddingModeToDimension,
  readInstallerRuntimeEnv,
  writeInstallerRuntimeEnv,
} from "../installer/runtime-config";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { ClackRuntimeMenuUi, IRuntimeMenuUi } from "../ui/runtime-menu";

export interface IRuntimeMenuDeps {
  ui: IRuntimeMenuUi;
  runner: ICommandRunner;
  homeDir: string;
  fs: IFileSystem;
  detectImportPath: (homeDir: string) => Promise<string | null>;
  readLastImportPath: (homeDir: string) => Promise<string | null>;
  persistLastImportPath: (homeDir: string, inputPath: string) => Promise<void>;
}

function createDefaultDeps(): IRuntimeMenuDeps {
  return {
    ui: new ClackRuntimeMenuUi(),
    runner: new ExecaCommandRunner(),
    homeDir: resolveUserHomeDir(process.platform, process.env),
    fs: nodeFileSystem,
    detectImportPath: detectLatestChatGptExportPath,
    readLastImportPath: readLastStartedChatGptImportPath,
    persistLastImportPath: persistLastStartedChatGptImportPath,
  };
}

async function handleImportChatGptAction(
  ui: IRuntimeMenuUi,
  homeDir: string,
  detectImportPath: (homeDir: string) => Promise<string | null>,
  readLastImportPath: (homeDir: string) => Promise<string | null>,
  persistLastImportPath: (homeDir: string, inputPath: string) => Promise<void>
): Promise<number> {
  let resolvedPath = await detectImportPath(homeDir);
  if (!resolvedPath) {
    const lastStartedImportPath = await readLastImportPath(homeDir);
    const pathPromptMessage = lastStartedImportPath
      ? "Path to ChatGPT export file/folder (Tab to accept)"
      : "Path to ChatGPT export file/folder";
    while (!resolvedPath) {
      const pathResult = await ui.promptInput({
        label: pathPromptMessage,
        placeholder: lastStartedImportPath ?? "~/Downloads/chatgpt-export.json",
        tabCycleValues: lastStartedImportPath ? [lastStartedImportPath] : undefined,
        required: true,
      });
      if (pathResult.status === "cancel") {
        await ui.note("Import cancelled.");
        return 0;
      }
      if (pathResult.status !== "submit") {
        continue;
      }
      resolvedPath = expandHomePath(pathResult.value, homeDir);
    }
  } else {
    await ui.note(`Auto-detected ChatGPT export: ${resolvedPath}`);
  }

  const defaultProject = "MemoryMesh";
  const defaultEngine = "rust";
  const defaultPolicy = "skip_existing";

  const projectResult = await ui.promptInput({
    label: `Project (default: ${defaultProject})`,
    placeholder: defaultProject,
    defaultValue: defaultProject,
    required: false,
  });
  if (projectResult.status === "cancel") {
    await ui.note("Import cancelled.");
    return 0;
  }
  const project = projectResult.status === "submit" && projectResult.value
    ? projectResult.value
    : defaultProject;

  const engineResult = await ui.promptInput({
    label: `Engine (ts|rust, default: ${defaultEngine})`,
    placeholder: defaultEngine,
    defaultValue: defaultEngine,
    tabCycleValues: ["rust", "ts"],
    required: false,
  });
  if (engineResult.status === "cancel") {
    await ui.note("Import cancelled.");
    return 0;
  }
  const engineInput = engineResult.status === "submit" ? engineResult.value : defaultEngine;
  const engine = engineInput === "ts" ? "ts" : "rust";

  const importPolicyResult = await ui.promptInput({
    label: `Import policy (skip_existing|import_anyway|overwrite_existing, default: ${defaultPolicy})`,
    placeholder: defaultPolicy,
    defaultValue: defaultPolicy,
    tabCycleValues: [
      "skip_existing",
      "import_anyway",
      "overwrite_existing",
    ],
    required: false,
  });
  if (importPolicyResult.status === "cancel") {
    await ui.note("Import cancelled.");
    return 0;
  }
  const importPolicyRaw = importPolicyResult.status === "submit"
    ? importPolicyResult.value
    : defaultPolicy;
  const importPolicy =
    importPolicyRaw === "import_anyway" || importPolicyRaw === "overwrite_existing"
      ? importPolicyRaw
      : "skip_existing";

  await ui.note(
    `Starting import with project=${project}, engine=${engine}, importPolicy=${importPolicy}.`
  );
  const { runImportGptCommand } = await import("./import-gpt");
  const code = await runImportGptCommand([
    "--path",
    resolvedPath,
    "--project",
    project,
    "--engine",
    engine,
    "--import-policy",
    importPolicy,
  ], {
    onImportStarted: async (startedPath: string) => {
      await persistLastImportPath(homeDir, startedPath);
    },
  });
  if (code === 0) {
    await ui.note("ChatGPT import completed.");
  } else {
    await ui.note("ChatGPT import failed. Check logs and retry.");
  }

  return code;
}

function truncateContent(content: string, maxChars = 80): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars - 3)}...`;
}

async function handleSearchAction(ui: IRuntimeMenuUi): Promise<number> {
  const { runSearchCommand } = await import("./search");

  while (true) {
    const queryResult = await ui.promptInput({
      label: "Search query (Ctrl+C to return to menu)",
      placeholder: "What are my recent notes?",
      required: false,
    });
    if (queryResult.status === "cancel") {
      return 0;
    }
    if (queryResult.status !== "submit") {
      continue;
    }
    const trimmed = queryResult.value.trim();
    if (!trimmed) {
      continue;
    }

    const result = await runSearchCommand(["--query", trimmed]);
    if (!result.ok) {
      await ui.note(result.message);
      continue;
    }
    if (result.results.length === 0) {
      await ui.note(`No memories found for "${trimmed}".`);
      continue;
    }

    await ui.note(`Found ${result.results.length} result(s) for "${trimmed}":`);
    for (let i = 0; i < result.results.length; i += 1) {
      const item = result.results[i];
      const snippet = truncateContent(item.snippet, 120);
      const source = item.source ? ` | source=${item.source}` : "";
      await ui.note(`${i + 1}. ${snippet}${source}`);
    }
  }
}

async function handleSettingsAction(
  ui: IRuntimeMenuUi,
  homeDir: string,
  fs: IFileSystem
): Promise<number> {
  const installConfig = await readInstallConfig(homeDir, fs);
  const runtimeEnv = await readInstallerRuntimeEnv(homeDir, fs);

  if (!installConfig) {
    await ui.note("No installer config found at ~/.memorymesh/config.json.");
    return 0;
  }

  await ui.note("Current settings:");
  await ui.note(`embeddingMode: ${installConfig.embeddingMode}`);
  await ui.note(`embeddingModel: ${installConfig.embeddingModel}`);
  await ui.note(`embeddingDimension: ${installConfig.embeddingDimension}`);
  await ui.note(`stackProjectDir: ${installConfig.stackProjectDir}`);
  await ui.note(`composeFilePath: ${installConfig.composeFilePath}`);
  await ui.note(
    `runtime.env EMBEDDING_MODEL: ${runtimeEnv.EMBEDDING_MODEL ?? "not set"}`
  );
  const selectedMode = await ui.selectEmbeddingMode(installConfig.embeddingMode);
  if (!selectedMode || selectedMode === installConfig.embeddingMode) {
    await ui.note("No settings changes applied.");
    return 0;
  }
  const nextConfig = {
    ...installConfig,
    embeddingMode: selectedMode,
    embeddingModel:
      selectedMode === "flash" ? "nomic-embed-text" : "mxbai-embed-large",
    embeddingDimension: mapEmbeddingModeToDimension(selectedMode),
  };

  await persistInstallConfig(
    homeDir,
    nextConfig,
    fs
  );
  await writeInstallerRuntimeEnv(
    homeDir,
    {
      embeddingMode: nextConfig.embeddingMode,
      embeddingModel: nextConfig.embeddingModel,
      embeddingDimension: nextConfig.embeddingDimension,
    },
    fs
  );
  await ui.note(`Settings saved: embeddingMode=${nextConfig.embeddingMode}.`);
  await ui.note(`Derived embeddingModel=${nextConfig.embeddingModel}.`);
  await ui.note(`Derived embeddingDimension=${nextConfig.embeddingDimension}.`);
  await ui.note(
    "Restart services to apply embedding changes. If model is missing, rerun setup to pull it."
  );
  return 0;
}

export async function runRuntimeMenu(
  deps: Partial<IRuntimeMenuDeps> = {}
): Promise<number> {
  const resolved = { ...createDefaultDeps(), ...deps };

  await resolved.ui.intro("MemoryMesh CLI");

  while (true) {
    const action = await resolved.ui.selectAction();
    if (!action || action === "exit") {
      await resolved.ui.outro("Bye.");
      return 0;
    }

    if (action === "import_chatgpt") {
      await handleImportChatGptAction(
        resolved.ui,
        resolved.homeDir,
        resolved.detectImportPath,
        resolved.readLastImportPath,
        resolved.persistLastImportPath
      );
      continue;
    }

    if (action === "import_documents") {
      await resolved.ui.note(
        "Document import is not implemented yet. This will be wired in a later phase."
      );
      continue;
    }

    if (action === "search_memories") {
      await handleSearchAction(resolved.ui);
      continue;
    }

    if (action === "settings") {
      await handleSettingsAction(resolved.ui, resolved.homeDir, resolved.fs);
      continue;
    }

    if (action === "doctor") {
      const code = await runDoctorCommand([], {
        runner: resolved.runner,
      });
      if (code === 0) {
        await resolved.ui.note("Doctor checks completed successfully.");
      } else {
        await resolved.ui.note("Doctor reported issues. Review checks above.");
      }
      continue;
    }

    if (action === "start_mcp_server") {
      await resolved.ui.note(
        "Starting MCP bridge (long-running). Use Ctrl+C to stop when finished."
      );
      const code = await runMcpCommand([], { runner: resolved.runner });
      if (code !== 0) {
        await resolved.ui.note(
          `MCP bridge exited with code ${code}. Run memorymesh doctor first if this persists.`
        );
      } else {
        await resolved.ui.note("MCP bridge exited normally.");
      }
      continue;
    }
  }
}
