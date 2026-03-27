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
  mapEmbeddingModelToDimension,
  mapEmbeddingModeToModel,
  readInstallerRuntimeEnv,
  writeInstallerRuntimeEnv,
} from "./runtime-config";
import { detectQdrantCollectionDimension } from "./qdrant-dimension";
import { inspectDirtySetupState } from "./dirty-state";
import {
  ensureInstallerManagedStack,
  getInstallerHomeDir,
  getInstallerManagedComposePath,
  getInstallerManagedStackDir,
  resolveStackMode,
} from "./stack-packaging";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { ExecaCommandRunner, ICommandRunner } from "../system/command-runner";
import {
  checkServiceRunning,
  checkDockerDaemon,
  checkDockerInstalled,
  downMemoryMeshStack,
  ICheckResult,
  pullOllamaModelWithRetry,
  startMemoryMeshStack,
  startOllamaService,
  verifySelectedEmbeddingModel,
  waitForOllamaReady,
} from "../system/docker";
import { checkHttpHealth } from "../system/health";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { joinFromHome, resolveUserHomeDir } from "../system/runtime-home";
import { IStackContext, resolveStackContext } from "../system/stack-context";
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

function resolveEmbeddingDimensionFromEnv(env: NodeJS.ProcessEnv): number | null {
  const mode = env.MEMORYMESH_EMBEDDING_MODE?.trim();
  if (mode === "flash" || mode === "medium") {
    return mapEmbeddingModeToDimension(mode);
  }

  const model = env.EMBEDDING_MODEL?.trim();
  if (typeof model === "string" && model.length > 0) {
    return mapEmbeddingModelToDimension(model);
  }

  const dimensionRaw = env.MEMORYMESH_EMBEDDING_DIMENSION?.trim();
  if (!dimensionRaw) {
    return null;
  }

  const parsed = Number.parseInt(dimensionRaw, 10);
  if (parsed === 768 || parsed === 1024) {
    return parsed;
  }

  return null;
}

async function resolveExistingEmbeddingDimension(
  runner: ICommandRunner,
  fs: IFileSystem,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  stackMode: "release-image" | "local-dev-build"
): Promise<number | null> {
  const runtimeEnv = await readInstallerRuntimeEnv(homeDir, fs);
  const installConfig = await readInstallConfig(homeDir, fs);
  const collectionName = env.QDRANT_COLLECTION?.trim() || "memories";

  const preferredSources = stackMode === "local-dev-build"
    ? [
        resolveEmbeddingDimensionFromEnv(env),
        resolveEmbeddingDimensionFromEnv(runtimeEnv),
        installConfig?.embeddingDimension ?? null,
      ]
    : [
        resolveEmbeddingDimensionFromEnv(runtimeEnv),
        installConfig?.embeddingDimension ?? null,
        resolveEmbeddingDimensionFromEnv(env),
      ];

  for (const candidate of preferredSources) {
    if (candidate === 768 || candidate === 1024) {
      return candidate;
    }
  }

  return detectQdrantCollectionDimension(runner, collectionName);
}

function resolveRequiredServiceAuthEnv(
  env: NodeJS.ProcessEnv,
  existingRuntimeEnv: NodeJS.ProcessEnv
): Pick<NodeJS.ProcessEnv, "MONGO_USER" | "MONGO_PASSWORD" | "NEO4J_USER" | "NEO4J_PASSWORD"> {
  const mongoUser =
    existingRuntimeEnv.MONGO_USER?.trim()
    || env.MONGO_USER?.trim()
    || "memorymesh";
  const mongoPassword =
    existingRuntimeEnv.MONGO_PASSWORD?.trim()
    || env.MONGO_PASSWORD?.trim()
    || randomBytes(16).toString("hex");
  const neo4jUser =
    existingRuntimeEnv.NEO4J_USER?.trim()
    || env.NEO4J_USER?.trim()
    || "neo4j";
  const neo4jPassword =
    existingRuntimeEnv.NEO4J_PASSWORD?.trim()
    || env.NEO4J_PASSWORD?.trim()
    || randomBytes(16).toString("hex");

  return {
    MONGO_USER: mongoUser,
    MONGO_PASSWORD: mongoPassword,
    NEO4J_USER: neo4jUser,
    NEO4J_PASSWORD: neo4jPassword,
  };
}

async function cleanupManagedState(
  resolved: ISetupWizardDeps,
  stackComposeExists: boolean,
  activeStackContext?: IStackContext
): Promise<ICheckResult> {
  if (activeStackContext) {
    const activeCleanupResult = await downMemoryMeshStack(
      resolved.runner,
      activeStackContext,
      true
    );
    if (!activeCleanupResult.ok) {
      return activeCleanupResult;
    }
  }

  if (stackComposeExists) {
    const cleanupStackContext: IStackContext = {
      projectDir: getInstallerManagedStackDir(resolved.homeDir),
      composeFilePath: getInstallerManagedComposePath(resolved.homeDir),
    };
    const sameAsActive =
      activeStackContext
      && activeStackContext.projectDir === cleanupStackContext.projectDir
      && activeStackContext.composeFilePath === cleanupStackContext.composeFilePath;
    if (!sameAsActive) {
      const cleanupResult = await downMemoryMeshStack(
        resolved.runner,
        cleanupStackContext,
        true
      );
      if (!cleanupResult.ok) {
        return cleanupResult;
      }
    }
  }

  await resolved.removePath(
    joinFromHome(resolved.homeDir, ".memorymesh", "checkpoints")
  );
  await resolved.removePath(getInstallerHomeDir(resolved.homeDir));
  return {
    ok: true,
    message: "Existing managed MemoryMesh state was removed.",
  };
}

export async function runSetupWizard(
  deps: Partial<ISetupWizardDeps> = {}
): Promise<"completed" | "cancelled"> {
  const resolved = { ...createDefaultDeps(), ...deps };
  let selectedCleanInstall = false;
  let setupCompleted = false;
  let useLocalBuildMode = false;
  let localBuildStackContext: IStackContext | null = null;

  await resolved.ui.intro("MemoryMesh first-time setup");

  try {
    let stackContext: IStackContext;
    let stackMode: "release-image" | "local-dev-build" = "release-image";
    const desiredStackMode = resolveStackMode(resolved.fs, {
      cwd: resolved.cwd,
      env: resolved.env,
    });
    useLocalBuildMode = desiredStackMode.mode === "local-dev-build";
    localBuildStackContext = useLocalBuildMode
      ? resolveStackContext(resolved.cwd, resolved.env, resolved.fs, resolved.homeDir)
      : null;
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
        const cleanupResult = await cleanupManagedState(
          resolved,
          dirtyState.signals.stackComposeExists,
          localBuildStackContext ?? undefined
        );
        if (!cleanupResult.ok) {
          return failWithMessage(
            resolved.ui,
            `Unable to reset previous managed stack: ${cleanupResult.message}`
          );
        }
        await resolved.ui.note(cleanupResult.message);
        needsManagedStackCleanup = true;
        forceFreshEmbeddingSelection = true;
      } else {
        await resolved.ui.note("Continuing setup with existing MemoryMesh state.");
      }
    }

    if (useLocalBuildMode && localBuildStackContext) {
      stackContext = localBuildStackContext;
      stackMode = "local-dev-build";
    } else {
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
    }
    await resolved.ui.note(
      stackMode === "local-dev-build"
        ? `Using repo-local stack mode (local-dev-build): ${stackContext.composeFilePath}`
        : `Using installer-managed stack mode (release-image): ${stackContext.composeFilePath}`
    );
    await resolved.ui.note(
      "Service endpoints are exposed through the stack gateway (Qdrant/Ollama/MongoDB/Neo4j)."
    );

    let existingDimension: number | null = null;
    if (!forceFreshEmbeddingSelection) {
      existingDimension = await resolveExistingEmbeddingDimension(
        resolved.runner,
        resolved.fs,
        resolved.homeDir,
        resolved.env,
        stackMode
      );
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

          const cleanupResult = await cleanupManagedState(
            resolved,
            resolved.fs.exists(getInstallerManagedComposePath(resolved.homeDir)),
            useLocalBuildMode ? stackContext : undefined
          );
          if (!cleanupResult.ok) {
            throw new Error(`Unable to reset managed state for new embedding model: ${cleanupResult.message}`);
          }
          needsManagedStackCleanup = true;
          await resolved.ui.note("Reset complete. Continuing setup with new embedding model.");
          if (useLocalBuildMode) {
            stackContext = resolveStackContext(
              resolved.cwd,
              resolved.env,
              resolved.fs,
              resolved.homeDir
            );
            stackMode = "local-dev-build";
          } else {
            const refreshedManagedStack = await ensureInstallerManagedStack(
              resolved.homeDir,
              resolved.fs,
              { cwd: resolved.cwd, env: resolved.env }
            );
            stackContext = refreshedManagedStack;
            stackMode = refreshedManagedStack.mode;
          }
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

    const existingRuntimeEnv = await readInstallerRuntimeEnv(
      resolved.homeDir,
      resolved.fs
    );
    const serviceAuthEnv = resolveRequiredServiceAuthEnv(
      resolved.env,
      existingRuntimeEnv
    );
    const runtimeEnv = {
      EMBEDDING_MODEL: mapEmbeddingModeToModel(selectedMode),
      MEMORYMESH_EMBEDDING_MODE: selectedMode,
      MEMORYMESH_EMBEDDING_DIMENSION: String(selectedDimension),
      ...serviceAuthEnv,
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
      return failWithMessage(
        resolved.ui,
        `${stackStarted.message} (mode=${stackMode}, compose=${stackContext.composeFilePath})`
      );
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
        mongoUser: serviceAuthEnv.MONGO_USER,
        mongoPassword: serviceAuthEnv.MONGO_PASSWORD,
        neo4jUser: serviceAuthEnv.NEO4J_USER,
        neo4jPassword: serviceAuthEnv.NEO4J_PASSWORD,
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
      const rollbackCleanup = await cleanupManagedState(
        resolved,
        resolved.fs.exists(getInstallerManagedComposePath(resolved.homeDir)),
        useLocalBuildMode ? localBuildStackContext ?? undefined : undefined
      );
      if (!rollbackCleanup.ok) {
        await resolved.ui.note(
          `Warning: temporary clean-install state could not be fully removed: ${rollbackCleanup.message}`
        );
      }
    }
  }
}
