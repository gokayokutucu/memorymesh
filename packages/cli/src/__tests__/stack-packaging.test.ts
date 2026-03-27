import {
  ensureInstallerManagedStack,
  getInstallerManagedComposePath,
  getInstallerManagedStackDir,
  resolveStackMode,
  resolveInstallerManagedStack,
} from "../installer/stack-packaging";
import { IFileSystem } from "../system/filesystem";

describe("stack packaging", () => {
  it("returns installer managed paths", () => {
    expect(getInstallerManagedStackDir("/tmp/home")).toBe("/tmp/home/.memorymesh/stack");
    expect(getInstallerManagedComposePath("/tmp/home")).toBe(
      "/tmp/home/.memorymesh/stack/docker-compose.yml"
    );
  });

  it("returns installer managed paths with Windows separators", () => {
    expect(getInstallerManagedStackDir("C:\\Users\\Test")).toBe(
      "C:\\Users\\Test\\.memorymesh\\stack"
    );
    expect(getInstallerManagedComposePath("C:\\Users\\Test")).toBe(
      "C:\\Users\\Test\\.memorymesh\\stack\\docker-compose.yml"
    );
  });

  it("creates installer-managed compose file", async () => {
    const writes: Record<string, string> = {};
    const fs: IFileSystem = {
      exists: (path: string) =>
        path.endsWith("apps/server/Dockerfile") || path.endsWith("package.json"),
      mkdir: async () => {},
      read: async () => "",
      write: async (path: string, content: string) => {
        writes[path] = content;
      },
    };

    const context = await ensureInstallerManagedStack("/tmp/home", fs, {
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "true" } as NodeJS.ProcessEnv,
    });
    expect(context.projectDir).toBe("/tmp/home/.memorymesh/stack");
    expect(context.composeFilePath).toBe("/tmp/home/.memorymesh/stack/docker-compose.yml");
    expect(context.mode).toBe("local-dev-build");
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).toContain("services:");
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).toContain(
      "dockerfile: \"apps/server/Dockerfile\""
    );
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).toContain(
      "EMBEDDING_MODEL=${EMBEDDING_MODEL}"
    );
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).toContain(
      "MONGO_INITDB_ROOT_USERNAME=${MONGO_USER}"
    );
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).toContain(
      "NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}"
    );
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).not.toContain(
      "NEO4J_AUTH=none"
    );
    expect(writes["/tmp/home/.memorymesh/stack/docker-compose.yml"]).not.toContain(
      "EMBEDDING_MODEL=${EMBEDDING_MODEL:-nomic-embed-text}"
    );
  });

  it("resolves existing installer-managed stack", () => {
    const fs: IFileSystem = {
      exists: (path: string) => path === "/tmp/home/.memorymesh/stack/docker-compose.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveInstallerManagedStack("/tmp/home", fs);
    expect(context?.projectDir).toBe("/tmp/home/.memorymesh/stack");
    expect(context?.composeFilePath).toBe("/tmp/home/.memorymesh/stack/docker-compose.yml");
    expect(context?.mode).toBe("release-image");
  });

  it("uses release-image mode when explicitly disabled", () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const mode = resolveStackMode(fs, {
      cwd: "/tmp/workspace",
      env: { MEMORYMESH_USE_LOCAL_BUILD: "false" } as NodeJS.ProcessEnv,
    });

    expect(mode.mode).toBe("release-image");
  });

  it("uses release-image mode by default when local build is not explicitly enabled", () => {
    const fs: IFileSystem = {
      exists: () => true,
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const mode = resolveStackMode(fs, {
      cwd: "/tmp/workspace",
      env: {} as NodeJS.ProcessEnv,
    });

    expect(mode.mode).toBe("release-image");
  });
});
