import {
  addMemoryMeshClaudeIntegration,
  resolveClaudeDesktopConfigPath,
  validateMemoryMeshMcpTarget,
} from "../installer/claude-config";
import { IFileSystem } from "../system/filesystem";
import { ICommandRunner } from "../system/command-runner";

describe("claude config integration", () => {
  it("resolves macOS config path", () => {
    const path = resolveClaudeDesktopConfigPath("darwin", "/Users/test");
    expect(path).toBe(
      "/Users/test/Library/Application Support/Claude/claude_desktop_config.json"
    );
  });

  it("resolves Windows config path", () => {
    const path = resolveClaudeDesktopConfigPath(
      "win32",
      "C:/Users/Test",
      "C:/Users/Test/AppData/Roaming"
    );
    expect(path).toBe(
      "C:\\Users\\Test\\AppData\\Roaming\\Claude\\claude_desktop_config.json"
    );
  });

  it("returns null for Windows when APPDATA is missing", () => {
    const path = resolveClaudeDesktopConfigPath(
      "win32",
      "C:/Users/Test",
      undefined
    );
    expect(path).toBeNull();
  });

  it("returns missing status when config file does not exist", async () => {
    const fs: IFileSystem = {
      exists: () => false,
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const result = await addMemoryMeshClaudeIntegration(
      "/tmp/claude_desktop_config.json",
      fs
    );

    expect(result.status).toBe("missing");
  });

  it("fails clearly on invalid JSON", async () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () => "{",
      write: async () => {},
    };

    await expect(
      addMemoryMeshClaudeIntegration("/tmp/claude_desktop_config.json", fs)
    ).rejects.toThrow("Invalid Claude Desktop config JSON");
  });

  it("does not rewrite when memorymesh entry is already up to date", async () => {
    let writes = 0;
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () =>
        JSON.stringify({
          mcpServers: {
            memorymesh: {
              command: "memorymesh",
              args: ["mcp"],
            },
          },
          theme: "dark",
        }),
      write: async () => {
        writes += 1;
      },
    };

    const result = await addMemoryMeshClaudeIntegration(
      "/tmp/claude_desktop_config.json",
      fs
    );

    expect(result.status).toBe("unchanged");
    expect(writes).toBe(0);
  });

  it("updates differing memorymesh entry and preserves unrelated fields", async () => {
    let written = "";
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () =>
        JSON.stringify({
          mcpServers: {
            memorymesh: {
              command: "wrong",
              args: ["value"],
            },
            existing: {
              command: "foo",
              args: ["bar"],
            },
          },
          theme: "dark",
        }),
      write: async (_path, content) => {
        written = content;
      },
    };

    const result = await addMemoryMeshClaudeIntegration(
      "/tmp/claude_desktop_config.json",
      fs
    );

    expect(result.status).toBe("updated");
    const parsed = JSON.parse(written) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
      theme: string;
    };
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.existing.command).toBe("foo");
    expect(parsed.mcpServers.memorymesh).toEqual({
      command: "memorymesh",
      args: ["mcp"],
    });
  });

  it("validates reachable MemoryMesh MCP target", async () => {
    const runner: ICommandRunner = {
      async run(): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        success: boolean;
      }> {
        return {
          stdout: '{"name":"memorymesh","mcp_endpoint":"/mcp"}',
          stderr: "",
          exitCode: 0,
          success: true,
        };
      },
    };

    const result = await validateMemoryMeshMcpTarget(runner);
    expect(result.ok).toBe(true);
  });

  it("returns warning when MemoryMesh MCP target is not reachable", async () => {
    const runner: ICommandRunner = {
      async run(): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        success: boolean;
      }> {
        return {
          stdout: "",
          stderr: "connection refused",
          exitCode: 1,
          success: false,
        };
      },
    };

    const result = await validateMemoryMeshMcpTarget(runner);
    expect(result.ok).toBe(false);
  });
});
