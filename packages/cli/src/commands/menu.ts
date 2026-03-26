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
import { detectQdrantCollectionDimension } from "../installer/qdrant-dimension";
import { runEmbeddingMismatchFlow } from "../installer/embedding-mismatch-flow";
import { resolveInstallerManagedStack } from "../installer/stack-packaging";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { ClackRuntimeMenuUi, IRuntimeMenuUi } from "../ui/runtime-menu";
import { runWizard, WizardStep } from "../ui/wizard";
import { downMemoryMeshStack, startMemoryMeshStack } from "../system/docker";
import { IStackContext } from "../system/stack-context";
import { resolveAuthoritativeEmbeddingConfig } from "../installer/embedding-authority";

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
  const defaultProject = "MemoryMesh";
  const defaultEngine = "rust";
  const defaultPolicy = "skip_existing";
  const detectedPath = await detectImportPath(homeDir);
  const lastStartedImportPath = detectedPath
    ? null
    : await readLastImportPath(homeDir);

  const steps: WizardStep[] = [
    {
      id: "path",
      run: async () => {
        if (detectedPath) {
          await ui.note(`Auto-detected ChatGPT export: ${detectedPath}`);
          return {
            type: "next",
            data: { path: detectedPath },
          };
        }

        const pathPromptMessage = lastStartedImportPath
          ? "Path to ChatGPT export file/folder (Tab to accept)"
          : "Path to ChatGPT export file/folder";
        while (true) {
          const pathResult = await ui.promptInput({
            label: pathPromptMessage,
            placeholder: lastStartedImportPath ?? "~/Downloads/chatgpt-export.json",
            tabCycleValues: lastStartedImportPath ? [lastStartedImportPath] : undefined,
            required: true,
          });
          if (pathResult.status === "cancel") {
            return { type: "cancel" };
          }
          if (pathResult.status !== "submit") {
            continue;
          }
          return {
            type: "next",
            data: {
              path: expandHomePath(pathResult.value, homeDir),
            },
          };
        }
      },
    },
    {
      id: "project",
      run: async () => {
        const projectResult = await ui.promptInput({
          label: `Project (default: ${defaultProject})`,
          placeholder: defaultProject,
          defaultValue: defaultProject,
          required: false,
        });
        if (projectResult.status === "cancel") {
          return { type: "cancel" };
        }
        if (projectResult.status !== "submit") {
          return { type: "cancel" };
        }
        return {
          type: "next",
          data: {
            project: projectResult.value || defaultProject,
          },
        };
      },
    },
    {
      id: "engine",
      run: async () => {
        const engineResult = await ui.promptInput({
          label: `Engine (ts|rust, default: ${defaultEngine})`,
          placeholder: defaultEngine,
          defaultValue: defaultEngine,
          tabCycleValues: ["rust", "ts"],
          required: false,
        });
        if (engineResult.status === "cancel") {
          return { type: "cancel" };
        }
        if (engineResult.status !== "submit") {
          return { type: "cancel" };
        }
        return {
          type: "next",
          data: {
            engine: engineResult.value === "ts" ? "ts" : "rust",
          },
        };
      },
    },
    {
      id: "import_policy",
      run: async () => {
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
          return { type: "cancel" };
        }
        if (importPolicyResult.status !== "submit") {
          return { type: "cancel" };
        }
        const importPolicyRaw = importPolicyResult.value;
        return {
          type: "next",
          data: {
            importPolicy:
              importPolicyRaw === "import_anyway" || importPolicyRaw === "overwrite_existing"
                ? importPolicyRaw
                : "skip_existing",
          },
        };
      },
    },
  ];

  const wizardResult = await runWizard(steps);
  if (!wizardResult) {
    await ui.note("Import cancelled.");
    return 0;
  }
  const resolvedPath = typeof wizardResult.data.path === "string"
    ? wizardResult.data.path
    : "";
  const project = typeof wizardResult.data.project === "string"
    ? wizardResult.data.project
    : defaultProject;
  const engine = wizardResult.data.engine === "ts" ? "ts" : "rust";
  const importPolicy = wizardResult.data.importPolicy === "import_anyway"
    || wizardResult.data.importPolicy === "overwrite_existing"
    ? wizardResult.data.importPolicy
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

async function handleImportDocumentsAction(
  ui: IRuntimeMenuUi,
  homeDir: string
): Promise<number> {
  const defaultProject = "MemoryMesh";
  const defaultPolicy = "skip_existing";

  const steps: WizardStep[] = [
    {
      id: "path",
      run: async () => {
        while (true) {
          const pathResult = await ui.promptInput({
            label: "Path to file/folder to import",
            placeholder: "~/Documents",
            required: true,
          });
          if (pathResult.status === "cancel") {
            return { type: "cancel" };
          }
          if (pathResult.status !== "submit") {
            continue;
          }
          return {
            type: "next",
            data: { path: expandHomePath(pathResult.value, homeDir) },
          };
        }
      },
    },
    {
      id: "project",
      run: async () => {
        const projectResult = await ui.promptInput({
          label: `Project (default: ${defaultProject})`,
          placeholder: defaultProject,
          defaultValue: defaultProject,
          required: false,
        });
        if (projectResult.status === "cancel") {
          return { type: "cancel" };
        }
        if (projectResult.status !== "submit") {
          return { type: "cancel" };
        }
        return {
          type: "next",
          data: { project: projectResult.value || defaultProject },
        };
      },
    },
    {
      id: "import_policy",
      run: async () => {
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
          return { type: "cancel" };
        }
        if (importPolicyResult.status !== "submit") {
          return { type: "cancel" };
        }
        const importPolicyRaw = importPolicyResult.value;
        return {
          type: "next",
          data: {
            importPolicy:
              importPolicyRaw === "import_anyway" || importPolicyRaw === "overwrite_existing"
                ? importPolicyRaw
                : "skip_existing",
          },
        };
      },
    },
  ];

  const wizardResult = await runWizard(steps);
  if (!wizardResult) {
    await ui.note("Import cancelled.");
    return 0;
  }

  const resolvedPath = typeof wizardResult.data.path === "string"
    ? wizardResult.data.path
    : "";
  const project = typeof wizardResult.data.project === "string"
    ? wizardResult.data.project
    : defaultProject;
  const importPolicy = wizardResult.data.importPolicy === "import_anyway"
    || wizardResult.data.importPolicy === "overwrite_existing"
    ? wizardResult.data.importPolicy
    : "skip_existing";

  await ui.note(
    `Starting document import with project=${project}, importPolicy=${importPolicy}.`
  );
  const { runImportDocumentsCommand } = await import("./import-documents");
  const code = await runImportDocumentsCommand([
    "--path",
    resolvedPath,
    "--project",
    project,
    "--import-policy",
    importPolicy,
  ]);
  if (code === 0) {
    await ui.note("Document import completed.");
  } else {
    await ui.note("Document import failed. Check logs and retry.");
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
  runner: ICommandRunner,
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
  const selectedModel: "nomic-embed-text" | "mxbai-embed-large" =
    selectedMode === "flash" ? "nomic-embed-text" : "mxbai-embed-large";
  const nextConfig = {
    ...installConfig,
    embeddingMode: selectedMode,
    embeddingModel: selectedModel,
    embeddingDimension: mapEmbeddingModeToDimension(selectedMode),
  };

  const collectionName = process.env.QDRANT_COLLECTION?.trim() || "memories";
  const existingDimension = await detectQdrantCollectionDimension(runner, collectionName);
  const nextRuntimeEnv: NodeJS.ProcessEnv = {
    EMBEDDING_MODEL: nextConfig.embeddingModel,
    MEMORYMESH_EMBEDDING_MODE: nextConfig.embeddingMode,
    MEMORYMESH_EMBEDDING_DIMENSION: String(nextConfig.embeddingDimension),
  };
  const stackContext = resolveInstallerManagedStack(homeDir, fs) ?? {
    projectDir: installConfig.stackProjectDir,
    composeFilePath: installConfig.composeFilePath,
  };

  try {
    const mismatchResult = await runEmbeddingMismatchFlow({
      existingDimension,
      selectedDimension: nextConfig.embeddingDimension,
      selectedMode: nextConfig.embeddingMode,
      selectedModel,
      ui,
      onApprovedReset: async () => {
        await ui.note("Embedding mismatch detected. Reset required.");
        await runEmbeddingReset(
          ui,
          runner,
          stackContext,
          nextRuntimeEnv,
          installConfig.stackMode ?? "release-image"
        );
      },
    });

    if (mismatchResult.status === "rejected" || mismatchResult.status === "cancelled") {
      await ui.note("No settings changes applied.");
      return 0;
    }
  } catch (error) {
    await ui.note(String(error));
    return 1;
  }

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
    "Embedding model updated."
  );
  return 0;
}

async function runEmbeddingReset(
  ui: IRuntimeMenuUi,
  runner: ICommandRunner,
  stackContext: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv,
  stackMode: "release-image" | "local-dev-build"
): Promise<void> {
  await ui.note("Resetting MemoryMesh state...");
  const downResult = await downMemoryMeshStack(runner, stackContext, true);
  if (!downResult.ok) {
    throw new Error(downResult.message);
  }

  const startResult = await startMemoryMeshStack(
    runner,
    stackContext,
    runtimeEnv,
    stackMode
  );
  if (!startResult.ok) {
    throw new Error(startResult.message);
  }
  await ui.note("Reset complete. Continuing action.");
}

async function ensureEmbeddingCompatibilityOrReset(
  ui: IRuntimeMenuUi,
  runner: ICommandRunner,
  homeDir: string,
  fs: IFileSystem
): Promise<boolean> {
  try {
    const authority = await resolveAuthoritativeEmbeddingConfig(homeDir, fs);
    const collectionName = process.env.QDRANT_COLLECTION?.trim() || "memories";
    const existingDimension = await detectQdrantCollectionDimension(runner, collectionName);
    const mismatchResult = await runEmbeddingMismatchFlow({
      existingDimension,
      selectedDimension: authority.embedding.embeddingDimension,
      selectedMode: authority.embedding.embeddingMode,
      selectedModel: authority.embedding.embeddingModel,
      ui,
      onApprovedReset: async () => {
        await ui.note("Embedding mismatch detected. Reset required.");
        const stackContext: IStackContext = resolveInstallerManagedStack(homeDir, fs) ?? {
          projectDir: authority.config.stackProjectDir,
          composeFilePath: authority.config.composeFilePath,
        };
        await runEmbeddingReset(
          ui,
          runner,
          stackContext,
          authority.runtimeEnv,
          authority.config.stackMode ?? "release-image"
        );
      },
    });

    if (mismatchResult.status === "rejected" || mismatchResult.status === "cancelled") {
      await ui.note("Action cancelled.");
      return false;
    }

    return true;
  } catch (error) {
    await ui.note(String(error));
    return false;
  }
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
      const ready = await ensureEmbeddingCompatibilityOrReset(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      if (!ready) {
        continue;
      }
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
      const ready = await ensureEmbeddingCompatibilityOrReset(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      if (!ready) {
        continue;
      }
      await handleImportDocumentsAction(
        resolved.ui,
        resolved.homeDir
      );
      continue;
    }

    if (action === "search_memories") {
      const ready = await ensureEmbeddingCompatibilityOrReset(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      if (!ready) {
        continue;
      }
      await handleSearchAction(resolved.ui);
      continue;
    }

    if (action === "settings") {
      await handleSettingsAction(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      continue;
    }

    if (action === "doctor") {
      const ready = await ensureEmbeddingCompatibilityOrReset(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      if (!ready) {
        continue;
      }
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
      const ready = await ensureEmbeddingCompatibilityOrReset(
        resolved.ui,
        resolved.runner,
        resolved.homeDir,
        resolved.fs
      );
      if (!ready) {
        continue;
      }
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
