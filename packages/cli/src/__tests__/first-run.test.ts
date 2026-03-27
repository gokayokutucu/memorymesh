import {
  getMemoryMeshConfigPath,
  isMemoryMeshInstalled,
  persistInstallConfig,
  readInstallConfig,
} from "../installer/first-run";
import { IFileSystem } from "../system/filesystem";

describe("installer first-run", () => {
  it("resolves config path in home directory", () => {
    expect(getMemoryMeshConfigPath("/tmp/home")).toBe("/tmp/home/.memorymesh/config.json");
  });

  it("resolves config path with Windows separators", () => {
    expect(getMemoryMeshConfigPath("C:\\Users\\Test")).toBe(
      "C:\\Users\\Test\\.memorymesh\\config.json"
    );
  });

  it("detects installation from config file existence", () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    expect(isMemoryMeshInstalled("/tmp/home", fs)).toBe(true);
  });

  it("persists install config", async () => {
    const writes: string[] = [];
    const fs: IFileSystem = {
      exists: () => false,
      mkdir: async () => {},
      read: async () => "",
      write: async (_path, content) => {
        writes.push(content);
      },
    };

    await persistInstallConfig(
      "/tmp/home",
      {
        installState: "installed",
        embeddingMode: "flash",
        embeddingModel: "nomic-embed-text",
        embeddingDimension: 768,
        installedAt: "2026-03-16T00:00:00.000Z",
        stackProjectDir: "/tmp/workspace",
        composeFilePath: "/tmp/workspace/docker-compose.yml",
      },
      fs
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("installState");
    expect(writes[0]).toContain("embeddingMode");
    expect(writes[0]).toContain("stackProjectDir");
    expect(writes[0]).toContain("composeFilePath");
    expect(writes[0]).toContain("nomic-embed-text");
  });

  it("returns null for invalid install config json", async () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () => "{",
      write: async () => {},
    };

    const config = await readInstallConfig("/tmp/home", fs);
    expect(config).toBeNull();
  });

  it("rejects unsupported embeddingMode values", async () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () =>
        JSON.stringify({
          installState: "installed",
          embeddingMode: "local",
          embeddingModel: "nomic-embed-text",
          embeddingDimension: 768,
          installedAt: "2026-03-16T00:00:00.000Z",
          stackProjectDir: "/tmp/workspace",
          composeFilePath: "/tmp/workspace/docker-compose.yml",
        }),
      write: async () => {},
    };

    const config = await readInstallConfig("/tmp/home", fs);
    expect(config).toBeNull();
  });

  it("derives embedding dimension for legacy config when missing", async () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () =>
        JSON.stringify({
          installState: "installed",
          embeddingMode: "flash",
          embeddingModel: "nomic-embed-text",
          installedAt: "2026-03-16T00:00:00.000Z",
          stackProjectDir: "/tmp/workspace",
          composeFilePath: "/tmp/workspace/docker-compose.yml",
        }),
      write: async () => {},
    };

    const config = await readInstallConfig("/tmp/home", fs);
    expect(config?.embeddingDimension).toBe(768);
  });
});
