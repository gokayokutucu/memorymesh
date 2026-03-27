import { dirname, join, win32 } from "node:path";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { ICommandRunner } from "../system/command-runner";

export interface IClaudeDesktopConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [key: string]: unknown;
}

export interface IClaudeIntegrationResult {
  status: "missing" | "unchanged" | "updated";
  previewMessage: string;
}

const EXPECTED_MEMORYMESH_ENTRY = {
  command: "memorymesh",
  args: ["mcp"],
};

export function resolveClaudeDesktopConfigPath(
  platform: NodeJS.Platform,
  homeDir: string,
  appData?: string
): string | null {
  if (platform === "darwin") {
    return join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  }

  if (platform === "win32") {
    if (!appData) {
      return null;
    }

    return win32.join(appData, "Claude", "claude_desktop_config.json");
  }

  return null;
}

function isExpectedMemoryMeshEntry(
  entry: { command: string; args?: string[] } | undefined
): boolean {
  if (!entry) {
    return false;
  }

  return (
    entry.command === EXPECTED_MEMORYMESH_ENTRY.command &&
    JSON.stringify(entry.args ?? []) === JSON.stringify(EXPECTED_MEMORYMESH_ENTRY.args)
  );
}

export async function addMemoryMeshClaudeIntegration(
  configPath: string,
  fs: IFileSystem = nodeFileSystem
): Promise<IClaudeIntegrationResult> {
  if (!fs.exists(configPath)) {
    return {
      status: "missing",
      previewMessage: "Claude Desktop config file is missing. Skipping automatic MCP config.",
    };
  }

  let existing: IClaudeDesktopConfig = {};
  try {
    existing = JSON.parse(await fs.read(configPath)) as IClaudeDesktopConfig;
  } catch {
    throw new Error(`Invalid Claude Desktop config JSON at ${configPath}`);
  }

  const currentServers = existing.mcpServers ?? {};
  const currentMemoryMeshEntry = currentServers.memorymesh;
  if (isExpectedMemoryMeshEntry(currentMemoryMeshEntry)) {
    return {
      status: "unchanged",
      previewMessage: "MemoryMesh MCP entry already exists and is up to date.",
    };
  }

  const nextServers = {
    ...currentServers,
    memorymesh: EXPECTED_MEMORYMESH_ENTRY,
  };

  const next: IClaudeDesktopConfig = {
    ...existing,
    mcpServers: nextServers,
  };

  await fs.mkdir(dirname(configPath));
  await fs.write(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return {
    status: "updated",
    previewMessage:
      currentMemoryMeshEntry === undefined
        ? "Will add MemoryMesh MCP entry to Claude Desktop config."
        : "Will update existing MemoryMesh MCP entry in Claude Desktop config.",
  };
}

export async function validateMemoryMeshMcpTarget(
  runner: ICommandRunner
): Promise<{ ok: boolean; message: string }> {
  const root = await runner.run("curl", ["-fsS", "http://localhost:3456/"]);
  if (!root.success) {
    return {
      ok: false,
      message: "Could not reach MemoryMesh HTTP endpoint at http://localhost:3456/.",
    };
  }

  const normalized = root.stdout.replace(/\s+/g, "");
  if (!normalized.includes("\"mcp_endpoint\":\"/mcp\"")) {
    return {
      ok: false,
      message:
        "MemoryMesh HTTP endpoint is reachable, but MCP endpoint metadata was not found.",
    };
  }

  return {
    ok: true,
    message: "MemoryMesh MCP HTTP target is reachable at http://localhost:3456/mcp.",
  };
}
