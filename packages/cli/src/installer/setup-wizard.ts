import {
  addMemoryMeshClaudeIntegration,
  resolveClaudeDesktopConfigPath,
  validateMemoryMeshMcpTarget,
} from "./claude-config";
import { persistInstallConfig, readInstallConfig } from "./first-run";
import {
  IEmbeddingMismatchFlowResult,
  runEmbeddingMismatchFlow,
} from "./embedding-mismatch-flow";
import {
  mapEmbeddingModeToDimension,
  mapEmbeddingModeToModel,
  writeInstallerRuntimeEnv,
} from "./runtime-config";
import { detectQdrantCollectionDimension } from "./qdrant-dimension";
import { inspectDirtySetupState } from "./dirty-state";
import { resetMemoryMeshState } from "./reset-state";
import {
  ensureInstallerManagedStack,
  getInstallerManagedComposePath,
} from "./stack-packaging";
import { rm } from "node:fs/promises";
import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import {
  checkServiceRunning,
  checkDockerDaemon,
  checkDockerInstalled,
  pullOllamaModelWithRetry,
  startMemoryMeshStack,
  startOllamaService,
  verifySelectedEmbeddingModel,
  waitForOllamaReady,
} from "../system/docker";
import { checkHttpHealth } from "../system/health";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { IStackContext } from "../system/stack-context";
import {
  ClackInstallerUi,
  IInstallerUi,
  OraSpinnerFactory,
  ISpinnerFactory,
} from "../ui/installer-ui";

export interface ISetupWizardDeps {
  runner: ICommandRunner;
  fs: IFileSystem;
  ui: IInstallerUi;
  spinnerFactory: ISpinnerFactory;
  homeDir: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  appData?: string;
  removePath(path: string): Promise<void>;
}

function createDefaultDeps(): ISetupWizardDeps {
  return {
    runner: new ExecaCommandRunner(),
    fs: nodeFileSystem,
    ui: new ClackInstallerUi(),
    spinnerFactory: new OraSpinnerFactory(),
    homeDir: resolveUserHomeDir(process.platform, process.env),
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    appData: process.env.APPDATA,
    async removePath(path: string): Promise<void> {
      await rm(path, { recursive: true, force: true });
    },
  };
}

async function failWithMessage(
  ui: IInstallerUi,
  message: string
): Promise<"cancelled"> {
  await ui.error(message);
  await ui.outro("Setup failed.");
  return "cancelled";
}

async function showClaudeRestartGuidance(ui: IInstallerUi): Promise<void> {
  await ui.note("MemoryMesh MCP entry is configured in Claude Desktop.");
  await ui.note("Please fully close and reopen Claude Desktop.");
  await ui.note("MemoryMesh MCP will not appear until Claude Desktop is restarted.");
}

function resolveEmbeddingMode(
  selectedModel: "nomic-embed-text" | "mxbai-embed-large"
): "flash" | "medium" {
  if (selectedModel === "nomic-embed-text") {
    return "flash";
  }

  return "medium";
}

export async function runSetupWizard(
  deps: Partial<ISetupWizardDeps> = {}
): Promise<"completed" | "cancelled"> {
  const resolved = { ...createDefaultDeps(), ...deps };
  let selectedCleanInstall = false;
  let setupCompleted = false;

  await resolved.ui.intro("MemoryMesh first-time setup");

  try {
    let stackContext: IStackContext;
    let stackMode: "release-image" | "local-dev-build" = "release-image";
    let needsManagedStackCleanup = false;
    let forceFreshEmbeddingSelection = false;

    const systemCheckSpinner = resolved.spinnerFactory.start("Running system checks");
    const dockerInstalled = await checkDockerInstalled(resolved.runner);
    if (!dockerInstalled.ok) {
      systemCheckSpinner.fail("Docker check failed");
      return failWithMessage(
        resolved.ui,
        "Docker is required. Install Docker Desktop and retry."
      );
    }

    const dockerDaemon = await checkDockerDaemon(resolved.runner);
    if (!dockerDaemon.ok) {
      systemCheckSpinner.fail("Docker daemon is not running");
      return failWithMessage(
        resolved.ui,
        "Docker daemon is not running. Start Docker Desktop and retry."
      );
    }
    systemCheckSpinner.succeed("System checks passed");

    const dirtyState = await inspectDirtySetupState(
      resolved.homeDir,
      resolved.fs,
      resolved.runner
    );
    if (dirtyState.hasDirtyState) {
      const action = await resolved.ui.selectDirtyStateAction({
        details: dirtyState.details,
      });

      if (!action || action === "exit") {
        await resolved.ui.outro("Setup cancelled.");
        return "cancelled";
      }

      if (action === "clean_install") {
        selectedCleanInstall = true;
        const cleanupResult = await resetMemoryMeshState({
          runner: resolved.runner,
          fs: resolved.fs,
          homeDir: resolved.homeDir,
          cwd: resolved.cwd,
          stackComposeExists: dirtyState.signals.stackComposeExists,
          removePath: resolved.removePath,
        });
        if (!cleanupResult.ok) {
          return failWithMessage(
            resolved.ui,
            `Unable to reset previous managed stack: ${cleanupResult.message}`
          );
        }
        await resolved.ui.note(cleanupResult.message);
        await resolved.ui.note(
          "Clean install removed previous state. Setup will continue and save your selected embedding as the new active state."
        );
        needsManagedStackCleanup = true;
        forceFreshEmbeddingSelection = true;
      } else {
        await resolved.ui.note("Continuing setup with existing MemoryMesh state.");
      }
    }

    try {
      const managedStack = await ensureInstallerManagedStack(
        resolved.homeDir,
        resolved.fs,
        { cwd: resolved.cwd, env: resolved.env }
      );
      stackContext = managedStack;
      stackMode = managedStack.mode;
    } catch (error) {
      if (needsManagedStackCleanup) {
        return failWithMessage(
          resolved.ui,
          `Unable to recreate installer-managed stack after cleanup: ${String(error)}`
        );
      }

      return failWithMessage(
        resolved.ui,
        `Unable to prepare installer-managed stack: ${String(error)}`
      );
    }

    let existingDimension: number | null = null;
    if (!forceFreshEmbeddingSelection) {
      const persistedConfig = await readInstallConfig(resolved.homeDir, resolved.fs);
      if (persistedConfig?.embeddingDimension) {
        existingDimension = persistedConfig.embeddingDimension;
      } else {
        const collectionName = process.env.QDRANT_COLLECTION?.trim() || "memories";
        const detectedDimension = await detectQdrantCollectionDimension(
          resolved.runner,
          collectionName
        );
        existingDimension = detectedDimension;
      }
    }

    let selectedModel = await resolved.ui.selectEmbeddingModel({
      existingDimension,
    });
    if (!selectedModel) {
      await resolved.ui.outro("Setup cancelled.");
      return "cancelled";
    }
    let selectedMode = resolveEmbeddingMode(selectedModel);
    let selectedDimension = mapEmbeddingModeToDimension(selectedMode);

    let mismatchResult: IEmbeddingMismatchFlowResult;
    try {
      mismatchResult = await runEmbeddingMismatchFlow({
        existingDimension,
        selectedDimension,
        selectedMode,
        selectedModel,
        ui: resolved.ui,
        onApprovedReset: async () => {
          await resolved.ui.note(
            "Selected model requires reset of existing embedding data."
          );
          await resolved.ui.note("Resetting MemoryMesh state...");

          const cleanupResult = await resetMemoryMeshState({
            runner: resolved.runner,
            fs: resolved.fs,
            homeDir: resolved.homeDir,
            cwd: resolved.cwd,
            stackComposeExists: resolved.fs.exists(
              getInstallerManagedComposePath(resolved.homeDir)
            ),
            removePath: resolved.removePath,
          });
          if (!cleanupResult.ok) {
            throw new Error(`Unable to reset managed state for new embedding model: ${cleanupResult.message}`);
          }
          needsManagedStackCleanup = true;
          await resolved.ui.note("Reset complete. Continuing setup with new embedding model.");
          const refreshedManagedStack = await ensureInstallerManagedStack(
            resolved.homeDir,
            resolved.fs,
            { cwd: resolved.cwd, env: resolved.env }
          );
          stackContext = refreshedManagedStack;
          stackMode = refreshedManagedStack.mode;
        },
      });
    } catch (error) {
      return failWithMessage(
        resolved.ui,
        String(error)
      );
    }

    if (mismatchResult.status === "rejected" || mismatchResult.status === "cancelled") {
      await resolved.ui.note("Setup cancelled. No changes were made.");
      await resolved.ui.outro("Setup cancelled.");
      return "cancelled";
    }

    if (mismatchResult.status === "approved" && !stackContext) {
      return failWithMessage(
        resolved.ui,
        "Unable to recreate installer-managed stack after embedding reset."
      );
    }

    const runtimeEnv = {
      EMBEDDING_MODEL: mapEmbeddingModeToModel(selectedMode),
      MEMORYMESH_EMBEDDING_MODE: selectedMode,
      MEMORYMESH_EMBEDDING_DIMENSION: String(selectedDimension),
    };

    const stackSpinner = resolved.spinnerFactory.start("Starting MemoryMesh stack");
    const stackStarted = await startMemoryMeshStack(
      resolved.runner,
      stackContext,
      runtimeEnv,
      stackMode
    );
    if (!stackStarted.ok) {
      stackSpinner.fail("MemoryMesh stack failed to start");
      return failWithMessage(resolved.ui, stackStarted.message);
    }
    stackSpinner.succeed("Stack started");

    const modelSpinner = resolved.spinnerFactory.start("Preparing Ollama model");
    const ollamaStarted = await startOllamaService(
      resolved.runner,
      stackContext,
      runtimeEnv
    );
    if (!ollamaStarted.ok) {
      modelSpinner.fail("Could not start ollama service");
      return failWithMessage(resolved.ui, ollamaStarted.message);
    }

    const ollamaReady = await waitForOllamaReady(
      resolved.runner,
      stackContext,
      runtimeEnv
    );
    if (!ollamaReady.ok) {
      modelSpinner.fail("Ollama is not ready");
      return failWithMessage(resolved.ui, ollamaReady.message);
    }

    const pulledModel = await pullOllamaModelWithRetry(
      resolved.runner,
      selectedModel,
      stackContext,
      runtimeEnv
    );
    if (!pulledModel.ok) {
      modelSpinner.fail("Could not pull embedding model");
      return failWithMessage(resolved.ui, pulledModel.message);
    }
    modelSpinner.succeed(`Ollama ready (${selectedModel})`);

    const healthSpinner = resolved.spinnerFactory.start("Running post-setup verification");
    const serviceNames = ["memorymesh", "mongodb", "neo4j", "qdrant", "ollama"];
    for (const serviceName of serviceNames) {
      const serviceCheck = await checkServiceRunning(
        resolved.runner,
        stackContext,
        serviceName
      );
      if (!serviceCheck.ok) {
        healthSpinner.fail("Service health check failed");
        return failWithMessage(resolved.ui, serviceCheck.message);
      }
    }

    const health = await checkHttpHealth(resolved.runner, "http://localhost:3456/health");
    if (!health.ok) {
      healthSpinner.fail("Health check failed");
      return failWithMessage(
        resolved.ui,
        `MemoryMesh API health check failed: ${health.message}`
      );
    }
    const selectedModelCheck = await verifySelectedEmbeddingModel(
      resolved.runner,
      stackContext,
      selectedModel,
      runtimeEnv
    );
    if (!selectedModelCheck.ok) {
      healthSpinner.fail("Selected embedding model verification failed");
      return failWithMessage(resolved.ui, selectedModelCheck.message);
    }
    healthSpinner.succeed("Post-setup verification passed");

    const shouldConfigureClaude = await resolved.ui.confirmClaudeIntegration();
    if (shouldConfigureClaude) {
      const configPath = resolveClaudeDesktopConfigPath(
        resolved.platform,
        resolved.homeDir,
        resolved.appData
      );

      if (configPath) {
        try {
          const integration = await addMemoryMeshClaudeIntegration(configPath, resolved.fs);
          await resolved.ui.note(integration.previewMessage);

          if (integration.status === "missing") {
            await resolved.ui.note(
              "Create Claude Desktop config manually, then add MemoryMesh MCP entry."
            );
          } else {
            const validation = await validateMemoryMeshMcpTarget(resolved.runner);
            if (validation.ok) {
              await resolved.ui.note(
                "MemoryMesh MCP has been added to Claude Desktop configuration."
              );
              await resolved.ui.note(
                "Runtime target validation passed."
              );
              await resolved.ui.note(validation.message);
              await showClaudeRestartGuidance(resolved.ui);
            } else {
              await resolved.ui.note(
                "MemoryMesh MCP entry was written to Claude Desktop configuration."
              );
              await resolved.ui.note(
                `Runtime target validation failed: ${validation.message}`
              );
              await showClaudeRestartGuidance(resolved.ui);
              await resolved.ui.note(
                "Please run memorymesh doctor and ensure services are healthy."
              );
            }
          }
        } catch (error) {
          await resolved.ui.note(
            `Claude integration update failed: ${String(error)}`
          );
          await resolved.ui.note(
            "Setup will continue. Fix Claude config manually and retry integration later."
          );
        }
      } else {
        await resolved.ui.note(
          "Claude Desktop config path could not be resolved for this platform."
        );
      }
    }

    await writeInstallerRuntimeEnv(
      resolved.homeDir,
      {
        embeddingMode: selectedMode,
        embeddingModel: selectedModel,
        embeddingDimension: selectedDimension,
      },
      resolved.fs
    );

    await persistInstallConfig(
      resolved.homeDir,
      {
        installState: "installed",
        embeddingMode: selectedMode,
        embeddingModel: selectedModel,
        embeddingDimension: selectedDimension,
        installedAt: new Date().toISOString(),
        stackProjectDir: stackContext.projectDir,
        composeFilePath: stackContext.composeFilePath,
        stackMode,
      },
      resolved.fs
    );

    setupCompleted = true;
    await resolved.ui.outro("MemoryMesh setup complete.");
    return "completed";
  } finally {
    if (selectedCleanInstall && !setupCompleted) {
      const rollbackCleanup = await resetMemoryMeshState({
        runner: resolved.runner,
        fs: resolved.fs,
        homeDir: resolved.homeDir,
        cwd: resolved.cwd,
        stackComposeExists: resolved.fs.exists(
          getInstallerManagedComposePath(resolved.homeDir)
        ),
        removePath: resolved.removePath,
      });
      if (!rollbackCleanup.ok) {
        await resolved.ui.note(
          `Warning: temporary clean-install state could not be fully removed: ${rollbackCleanup.message}`
        );
      }
    }
  }
}
