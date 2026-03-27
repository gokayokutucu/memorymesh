import { ICommandRunner } from "./command-runner";
import {
  checkDockerDaemon,
  checkDockerInstalled,
  checkServiceRunning,
  pullOllamaModelWithRetry,
  startMemoryMeshStack,
  startOllamaService,
  waitForOllamaReady,
} from "./docker";
import { checkHttpHealth } from "./health";
import { IFileSystem, nodeFileSystem } from "./filesystem";
import { resolveUserHomeDir } from "./runtime-home";
import { IStackContext } from "./stack-context";
import {
  addMemoryMeshClaudeIntegration,
  resolveClaudeDesktopConfigPath,
  validateMemoryMeshMcpTarget,
} from "../installer/claude-config";
import {
  getMemoryMeshConfigPath,
  IInstallConfig,
} from "../installer/first-run";
import {
  getInstallerRuntimeEnvPath,
  parseRuntimeEnv,
} from "../installer/runtime-config";
import {
  IResolvedAuthority,
  resolveAuthoritativeEmbeddingConfig,
} from "../installer/embedding-authority";

export type TDoctorSeverity = "healthy" | "warning" | "error";

export type TDoctorFixAction =
  | "restart_stack"
  | "repull_embedding_model"
  | "repair_claude_mcp"
  | "regenerate_runtime_env";

export interface IDoctorCheck {
  id: string;
  name: string;
  severity: TDoctorSeverity;
  message: string;
  fixAction?: TDoctorFixAction;
}

export interface IDoctorSummary {
  healthy: number;
  warnings: number;
  errors: number;
}

export interface IDoctorReport {
  checks: IDoctorCheck[];
  summary: IDoctorSummary;
  fixActions: TDoctorFixAction[];
}

export interface IRunDoctorChecksInput {
  runner: ICommandRunner;
  stackContext: IStackContext;
  fs?: IFileSystem;
  homeDir?: string;
  platform?: NodeJS.Platform;
  appData?: string;
}

export interface IApplyDoctorFixesInput {
  runner: ICommandRunner;
  stackContext: IStackContext;
  actions: TDoctorFixAction[];
  fs?: IFileSystem;
  homeDir?: string;
  platform?: NodeJS.Platform;
  appData?: string;
}

export interface IFixActionResult {
  action: TDoctorFixAction;
  ok: boolean;
  message: string;
}

interface IParsedInstallConfig {
  status: "missing" | "invalid" | "valid";
  config: IInstallConfig | null;
  message: string;
}

interface IParsedRuntimeEnv {
  status: "missing" | "invalid" | "valid";
  env: NodeJS.ProcessEnv;
  embeddingMode: "flash" | "medium" | null;
  embeddingModel: string | null;
  embeddingDimension: number | null;
  message: string;
}

const MEMORYMESH_MCP_ENTRY = JSON.stringify({
  command: "memorymesh",
  args: ["mcp"],
});

function buildSummary(checks: IDoctorCheck[]): IDoctorSummary {
  const healthy = checks.filter((check) => check.severity === "healthy").length;
  const warnings = checks.filter((check) => check.severity === "warning").length;
  const errors = checks.filter((check) => check.severity === "error").length;
  return {
    healthy,
    warnings,
    errors,
  };
}

function collectFixActions(checks: IDoctorCheck[]): TDoctorFixAction[] {
  const unique = new Set<TDoctorFixAction>();
  for (const check of checks) {
    if (check.fixAction) {
      unique.add(check.fixAction);
    }
  }

  return Array.from(unique);
}

function isValidEmbeddingMode(value: string | undefined): value is "flash" | "medium" {
  return value === "flash" || value === "medium";
}

async function parseInstallConfig(homeDir: string, fs: IFileSystem): Promise<IParsedInstallConfig> {
  const configPath = getMemoryMeshConfigPath(homeDir);
  if (!fs.exists(configPath)) {
    return {
      status: "missing",
      config: null,
      message: `Install config is missing at ${configPath}.`,
    };
  }

  try {
    const raw = JSON.parse(await fs.read(configPath)) as Partial<IInstallConfig>;
    if (
      raw.installState !== "installed" ||
      (raw.embeddingMode !== "flash" && raw.embeddingMode !== "medium") ||
      typeof raw.embeddingModel !== "string" ||
      (raw.embeddingDimension !== undefined &&
        typeof raw.embeddingDimension !== "number") ||
      typeof raw.installedAt !== "string" ||
      typeof raw.stackProjectDir !== "string" ||
      typeof raw.composeFilePath !== "string" ||
      (raw.stackMode !== undefined &&
        raw.stackMode !== "release-image" &&
        raw.stackMode !== "local-dev-build")
    ) {
      return {
        status: "invalid",
        config: null,
        message: `Install config is invalid at ${configPath}.`,
      };
    }

    const expectedModel = raw.embeddingMode === "flash" ? "nomic-embed-text" : "mxbai-embed-large";
    const expectedDimension = raw.embeddingMode === "flash" ? 768 : 1024;
    const embeddingDimension = raw.embeddingDimension ?? expectedDimension;
    if (raw.embeddingModel !== expectedModel || embeddingDimension !== expectedDimension) {
      return {
        status: "invalid",
        config: null,
        message: `Install config embedding metadata mismatch at ${configPath}.`,
      };
    }

    return {
      status: "valid",
      config: {
        installState: "installed",
        embeddingMode: raw.embeddingMode,
        embeddingModel: raw.embeddingModel,
        embeddingDimension,
        installedAt: raw.installedAt,
        stackProjectDir: raw.stackProjectDir,
        composeFilePath: raw.composeFilePath,
        stackMode: raw.stackMode ?? "release-image",
      },
      message: `Install config is valid (${configPath}).`,
    };
  } catch {
    return {
      status: "invalid",
      config: null,
      message: `Install config contains invalid JSON at ${configPath}.`,
    };
  }
}

async function parseManagedRuntimeEnv(homeDir: string, fs: IFileSystem): Promise<IParsedRuntimeEnv> {
  const runtimeEnvPath = getInstallerRuntimeEnvPath(homeDir);
  if (!fs.exists(runtimeEnvPath)) {
    return {
      status: "missing",
      env: {},
      embeddingMode: null,
      embeddingModel: null,
      embeddingDimension: null,
      message: `Runtime env is missing at ${runtimeEnvPath}.`,
    };
  }

  try {
    const parsed = parseRuntimeEnv(await fs.read(runtimeEnvPath));
    const embeddingModeRaw = parsed.MEMORYMESH_EMBEDDING_MODE;
    const embeddingModelRaw = parsed.EMBEDDING_MODEL;
    const embeddingDimensionRaw = parsed.MEMORYMESH_EMBEDDING_DIMENSION;
    const embeddingMode = isValidEmbeddingMode(embeddingModeRaw) ? embeddingModeRaw : null;
    const embeddingModel = embeddingModelRaw?.trim() ? embeddingModelRaw.trim() : null;
    const embeddingDimension = Number(embeddingDimensionRaw);
    const hasEmbeddingDimension = Number.isFinite(embeddingDimension) && embeddingDimension > 0;

    if (!embeddingMode || !embeddingModel || !hasEmbeddingDimension) {
      return {
        status: "invalid",
        env: parsed,
        embeddingMode,
        embeddingModel,
        embeddingDimension: hasEmbeddingDimension ? embeddingDimension : null,
        message: `Runtime env is invalid at ${runtimeEnvPath}; expected MEMORYMESH_EMBEDDING_MODE, EMBEDDING_MODEL, and MEMORYMESH_EMBEDDING_DIMENSION.`,
      };
    }

    return {
      status: "valid",
      env: parsed,
      embeddingMode,
      embeddingModel,
      embeddingDimension,
      message: `Runtime env is valid (${runtimeEnvPath}).`,
    };
  } catch {
    return {
      status: "invalid",
      env: {},
      embeddingMode: null,
      embeddingModel: null,
      embeddingDimension: null,
      message: `Runtime env could not be parsed at ${runtimeEnvPath}.`,
    };
  }
}

function resolveSelectedEmbeddingModel(installConfig: IParsedInstallConfig): string | null {
  if (installConfig.status !== "valid" || !installConfig.config) {
    return null;
  }
  return installConfig.config.embeddingModel;
}

function evaluateRuntimeEnvCheck(
  installConfig: IParsedInstallConfig,
  runtimeEnv: IParsedRuntimeEnv
): IDoctorCheck {
  if (installConfig.status !== "valid" || !installConfig.config) {
    return {
      id: "runtime-env",
      name: "Runtime env",
      severity:
        runtimeEnv.status === "valid"
          ? "healthy"
          : runtimeEnv.status === "missing"
            ? "warning"
            : "error",
      message: runtimeEnv.message,
    };
  }

  if (runtimeEnv.status !== "valid") {
    return {
      id: "runtime-env",
      name: "Runtime env",
      severity: runtimeEnv.status === "missing" ? "warning" : "error",
      message: `${runtimeEnv.message} It will be regenerated from install config.`,
      fixAction: "regenerate_runtime_env",
    };
  }

  const config = installConfig.config;
  const hasDrift =
    runtimeEnv.embeddingMode !== config.embeddingMode
    || runtimeEnv.embeddingModel !== config.embeddingModel
    || runtimeEnv.embeddingDimension !== config.embeddingDimension;
  if (hasDrift) {
    return {
      id: "runtime-env",
      name: "Runtime env",
      severity: "warning",
      message: "Runtime env drift detected against install config. Regeneration required.",
      fixAction: "regenerate_runtime_env",
    };
  }

  return {
    id: "runtime-env",
    name: "Runtime env",
    severity: "healthy",
    message: "Runtime env matches install config.",
  };
}

async function isEmbeddingModelInstalled(
  runner: ICommandRunner,
  stackContext: IStackContext,
  selectedModel: string,
  runtimeEnv: NodeJS.ProcessEnv = {}
): Promise<boolean> {
  const result = await runner.run("docker", [
    "compose",
    "-f",
    stackContext.composeFilePath,
    "--project-directory",
    stackContext.projectDir,
    "exec",
    "-T",
    "ollama",
    "ollama",
    "list",
  ], {
    env: { ...process.env, ...runtimeEnv },
  });
  if (!result.success) {
    return false;
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.toUpperCase() !== "NAME");

  return lines.some((line) => {
    const modelToken = line.split(/\s+/)[0] ?? "";
    return (
      modelToken === selectedModel ||
      modelToken.startsWith(`${selectedModel}:`) ||
      line.startsWith(`${selectedModel} `)
    );
  });
}

async function checkClaudeIntegration(
  fs: IFileSystem,
  platform: NodeJS.Platform,
  homeDir: string,
  appData?: string
): Promise<IDoctorCheck[]> {
  const checks: IDoctorCheck[] = [];
  const configPath = resolveClaudeDesktopConfigPath(platform, homeDir, appData);

  if (!configPath) {
    checks.push({
      id: "claude-config-unsupported",
      name: "Claude Desktop config",
      severity: "warning",
      message: "Claude Desktop path is not supported on this platform.",
    });
    return checks;
  }

  if (!fs.exists(configPath)) {
    checks.push({
      id: "claude-config-missing",
      name: "Claude Desktop config",
      severity: "warning",
      message: `Claude Desktop config is missing at ${configPath}.`,
      fixAction: "repair_claude_mcp",
    });
    return checks;
  }

  try {
    const parsed = JSON.parse(await fs.read(configPath)) as {
      mcpServers?: Record<string, { command: string; args?: string[] }>;
    };

    checks.push({
      id: "claude-config-json",
      name: "Claude Desktop config JSON",
      severity: "healthy",
      message: "Claude Desktop config JSON is valid.",
    });

    const memorymeshEntry = parsed.mcpServers?.memorymesh;
    const normalized = JSON.stringify({
      command: memorymeshEntry?.command,
      args: memorymeshEntry?.args ?? [],
    });

    if (normalized !== MEMORYMESH_MCP_ENTRY) {
      checks.push({
        id: "claude-config-memorymesh-entry",
        name: "Claude Desktop MemoryMesh MCP entry",
        severity: "warning",
        message: "Claude Desktop MemoryMesh MCP entry is missing or mismatched.",
        fixAction: "repair_claude_mcp",
      });
    } else {
      checks.push({
        id: "claude-config-memorymesh-entry",
        name: "Claude Desktop MemoryMesh MCP entry",
        severity: "healthy",
        message: "Claude Desktop MemoryMesh MCP entry is configured.",
      });
    }
  } catch {
    checks.push({
      id: "claude-config-invalid",
      name: "Claude Desktop config JSON",
      severity: "error",
      message: `Claude Desktop config has invalid JSON at ${configPath}.`,
    });
  }

  return checks;
}

export async function runDoctorChecks(
  input: IRunDoctorChecksInput
): Promise<IDoctorReport> {
  const fs = input.fs ?? nodeFileSystem;
  const homeDir = input.homeDir ?? resolveUserHomeDir(input.platform ?? process.platform);
  const platform = input.platform ?? process.platform;
  const appData = input.appData ?? process.env.APPDATA;

  const checks: IDoctorCheck[] = [];
  let runtimeEnvRegeneratedFromConfig = false;
  let runtimeEnvForChecks: NodeJS.ProcessEnv = {};
  try {
    const authority = await resolveAuthoritativeEmbeddingConfig(homeDir, fs);
    runtimeEnvRegeneratedFromConfig = authority.runtimeEnvRegenerated;
    runtimeEnvForChecks = authority.runtimeEnv;
  } catch {
    runtimeEnvRegeneratedFromConfig = false;
    runtimeEnvForChecks = {};
  }

  const dockerInstalled = await checkDockerInstalled(input.runner);
  checks.push({
    id: "docker-installed",
    name: "Docker installed",
    severity: dockerInstalled.ok ? "healthy" : "error",
    message: dockerInstalled.message,
  });

  if (!dockerInstalled.ok) {
    const summary = buildSummary(checks);
    return {
      checks,
      summary,
      fixActions: collectFixActions(checks),
    };
  }

  const dockerDaemon = await checkDockerDaemon(input.runner);
  checks.push({
    id: "docker-daemon",
    name: "Docker daemon",
    severity: dockerDaemon.ok ? "healthy" : "error",
    message: dockerDaemon.message,
  });

  if (!dockerDaemon.ok) {
    const installConfig = await parseInstallConfig(homeDir, fs);
    checks.push({
      id: "install-config",
      name: "Install config",
      severity:
        installConfig.status === "valid"
          ? "healthy"
          : installConfig.status === "missing"
            ? "warning"
            : "error",
      message: installConfig.message,
    });

    const runtimeEnv = await parseManagedRuntimeEnv(homeDir, fs);
    checks.push(evaluateRuntimeEnvCheck(installConfig, runtimeEnv));
    if (runtimeEnvRegeneratedFromConfig) {
      checks.push({
        id: "runtime-env-regenerated",
        name: "Runtime env regeneration",
        severity: "healthy",
        message: "Runtime env was regenerated from install config.",
      });
    }

    checks.push(...(await checkClaudeIntegration(fs, platform, homeDir, appData)));

    const summary = buildSummary(checks);
    return {
      checks,
      summary,
      fixActions: collectFixActions(checks),
    };
  }

  const services = [
    { id: "service-memorymesh", service: "memorymesh", name: "memorymesh service" },
    { id: "service-mongodb", service: "mongodb", name: "mongodb service" },
    { id: "service-neo4j", service: "neo4j", name: "neo4j service" },
    { id: "service-qdrant", service: "qdrant", name: "qdrant service" },
    { id: "service-ollama", service: "ollama", name: "ollama service" },
  ];

  for (const service of services) {
    const result = await checkServiceRunning(input.runner, input.stackContext, service.service);
    checks.push({
      id: service.id,
      name: service.name,
      severity: result.ok ? "healthy" : "error",
      message: result.message,
      fixAction: result.ok ? undefined : "restart_stack",
    });
  }

  const httpHealth = await checkHttpHealth(input.runner, "http://localhost:3456/health");
  checks.push({
    id: "memorymesh-http",
    name: "MemoryMesh HTTP health",
    severity: httpHealth.ok ? "healthy" : "error",
    message: httpHealth.message,
    fixAction: httpHealth.ok ? undefined : "restart_stack",
  });

  const installConfig = await parseInstallConfig(homeDir, fs);
  checks.push({
    id: "install-config",
    name: "Install config",
    severity:
      installConfig.status === "valid"
        ? "healthy"
        : installConfig.status === "missing"
          ? "warning"
          : "error",
    message: installConfig.message,
  });

  const runtimeEnv = await parseManagedRuntimeEnv(homeDir, fs);
  checks.push(evaluateRuntimeEnvCheck(installConfig, runtimeEnv));
  if (runtimeEnvRegeneratedFromConfig) {
    checks.push({
      id: "runtime-env-regenerated",
      name: "Runtime env regeneration",
      severity: "healthy",
      message: "Runtime env was regenerated from install config.",
    });
  }

  const selectedModel = resolveSelectedEmbeddingModel(installConfig);
  if (!selectedModel) {
    checks.push({
      id: "embedding-model-selected",
      name: "Selected embedding model",
      severity: "error",
      message: "Selected embedding model is not configured in install config or runtime env.",
    });
  } else {
    const installed = await isEmbeddingModelInstalled(
      input.runner,
      input.stackContext,
      selectedModel,
      runtimeEnvForChecks
    );
    checks.push({
      id: "embedding-model-installed",
      name: "Selected embedding model in Ollama",
      severity: installed ? "healthy" : "error",
      message: installed
        ? `${selectedModel} is installed in Ollama.`
        : `${selectedModel} is missing in Ollama.`,
      fixAction: installed ? undefined : "repull_embedding_model",
    });
  }

  checks.push(...(await checkClaudeIntegration(fs, platform, homeDir, appData)));

  const summary = buildSummary(checks);
  return {
    checks,
    summary,
    fixActions: collectFixActions(checks),
  };
}

function dedupeActions(actions: TDoctorFixAction[]): TDoctorFixAction[] {
  return Array.from(new Set(actions));
}

async function fixRestartStack(
  runner: ICommandRunner,
  stackContext: IStackContext,
  fs: IFileSystem,
  homeDir: string
): Promise<IFixActionResult> {
  let authority: IResolvedAuthority;
  try {
    authority = await resolveAuthoritativeEmbeddingConfig(homeDir, fs);
  } catch (error) {
    return {
      action: "restart_stack",
      ok: false,
      message: `Cannot restart stack with authoritative embedding config: ${String(error)}`,
    };
  }
  const installConfig = await parseInstallConfig(homeDir, fs);
  const mode =
    installConfig.status === "valid" && installConfig.config
      ? installConfig.config.stackMode ?? "release-image"
      : "release-image";

  const result = await startMemoryMeshStack(runner, stackContext, authority.runtimeEnv, mode);
  if (!result.ok) {
    return {
      action: "restart_stack",
      ok: false,
      message: `Failed to restart stack: ${result.message}`,
    };
  }

  return {
    action: "restart_stack",
    ok: true,
    message: "Stack restart attempted with docker compose up -d.",
  };
}

async function fixRepullEmbeddingModel(
  runner: ICommandRunner,
  stackContext: IStackContext,
  fs: IFileSystem,
  homeDir: string
): Promise<IFixActionResult> {
  let authority: IResolvedAuthority;
  try {
    authority = await resolveAuthoritativeEmbeddingConfig(homeDir, fs);
  } catch (error) {
    return {
      action: "repull_embedding_model",
      ok: false,
      message: `Cannot resolve authoritative embedding config: ${String(error)}`,
    };
  }
  const model = authority.embedding.embeddingModel;

  if (!model) {
    return {
      action: "repull_embedding_model",
      ok: false,
      message: "Cannot re-pull model because selected embedding model is not configured.",
    };
  }

  const env = authority.runtimeEnv;
  const ollamaStarted = await startOllamaService(runner, stackContext, env);
  if (!ollamaStarted.ok) {
    return {
      action: "repull_embedding_model",
      ok: false,
      message: `Unable to start ollama service: ${ollamaStarted.message}`,
    };
  }

  const ready = await waitForOllamaReady(runner, stackContext, env);
  if (!ready.ok) {
    return {
      action: "repull_embedding_model",
      ok: false,
      message: `Ollama did not become ready before pull: ${ready.message}`,
    };
  }

  const pulled = await pullOllamaModelWithRetry(runner, model, stackContext, env);
  if (!pulled.ok) {
    return {
      action: "repull_embedding_model",
      ok: false,
      message: pulled.message,
    };
  }

  return {
    action: "repull_embedding_model",
    ok: true,
    message: `Re-pulled embedding model ${model}.`,
  };
}

async function fixRepairClaudeMcp(
  fs: IFileSystem,
  platform: NodeJS.Platform,
  homeDir: string,
  appData: string | undefined,
  runner: ICommandRunner
): Promise<IFixActionResult> {
  const configPath = resolveClaudeDesktopConfigPath(platform, homeDir, appData);
  if (!configPath) {
    return {
      action: "repair_claude_mcp",
      ok: false,
      message: "Cannot repair Claude MCP config automatically on this platform.",
    };
  }

  try {
    const result = await addMemoryMeshClaudeIntegration(configPath, fs);
    if (result.status === "missing") {
      return {
        action: "repair_claude_mcp",
        ok: false,
        message: result.previewMessage,
      };
    }

    const validation = await validateMemoryMeshMcpTarget(runner);
    if (!validation.ok) {
      return {
        action: "repair_claude_mcp",
        ok: false,
        message: `Claude MCP config updated, but target validation failed: ${validation.message}`,
      };
    }

    return {
      action: "repair_claude_mcp",
      ok: true,
      message: "Claude MCP configuration repaired. Please restart Claude Desktop.",
    };
  } catch (error) {
    return {
      action: "repair_claude_mcp",
      ok: false,
      message: `Claude MCP repair failed: ${String(error)}`,
    };
  }
}

async function fixRegenerateRuntimeEnv(
  fs: IFileSystem,
  homeDir: string
): Promise<IFixActionResult> {
  try {
    const authority = await resolveAuthoritativeEmbeddingConfig(homeDir, fs);
    if (authority.runtimeEnvRegenerated) {
      return {
        action: "regenerate_runtime_env",
        ok: true,
        message: "Regenerated ~/.memorymesh/runtime.env from install config.",
      };
    }
    return {
      action: "regenerate_runtime_env",
      ok: true,
      message: "Runtime env already matches install config.",
    };
  } catch {
    return {
      action: "regenerate_runtime_env",
      ok: false,
      message: "Cannot regenerate runtime env because install config is missing or invalid.",
    };
  }
}

export async function applyDoctorFixes(
  input: IApplyDoctorFixesInput
): Promise<IFixActionResult[]> {
  const fs = input.fs ?? nodeFileSystem;
  const homeDir = input.homeDir ?? resolveUserHomeDir(input.platform ?? process.platform);
  const platform = input.platform ?? process.platform;
  const appData = input.appData ?? process.env.APPDATA;
  const actions = dedupeActions(input.actions);

  const results: IFixActionResult[] = [];

  for (const action of actions) {
    if (action === "restart_stack") {
      results.push(
        await fixRestartStack(input.runner, input.stackContext, fs, homeDir)
      );
      continue;
    }

    if (action === "repull_embedding_model") {
      results.push(
        await fixRepullEmbeddingModel(input.runner, input.stackContext, fs, homeDir)
      );
      continue;
    }

    if (action === "repair_claude_mcp") {
      results.push(
        await fixRepairClaudeMcp(fs, platform, homeDir, appData, input.runner)
      );
      continue;
    }

    if (action === "regenerate_runtime_env") {
      results.push(await fixRegenerateRuntimeEnv(fs, homeDir));
    }
  }

  return results;
}
