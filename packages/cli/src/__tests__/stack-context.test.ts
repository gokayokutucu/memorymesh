import { resolveStackContext } from "../system/stack-context";
import { IFileSystem } from "../system/filesystem";

describe("stack context resolution", () => {
  it("prefers installer-managed stack over environment hints", () => {
    const fs: IFileSystem = {
      exists: (path) =>
        path === "/home/test/.memorymesh/stack/docker-compose.yml" ||
        path === "/tmp/stack/custom.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext(
      "/tmp/current",
      {
        MEMORYMESH_COMPOSE_FILE: "/tmp/stack/custom.yml",
        MEMORYMESH_STACK_DIR: "/tmp/stack",
      },
      fs,
      "/home/test"
    );

    expect(context.projectDir).toBe("/home/test/.memorymesh/stack");
    expect(context.composeFilePath).toBe(
      "/home/test/.memorymesh/stack/docker-compose.yml"
    );
  });

  it("uses MEMORYMESH_STACK_DIR when provided", () => {
    const fs: IFileSystem = {
      exists: (path) => path === "/tmp/stack/docker-compose.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext(
      "/tmp/current",
      { MEMORYMESH_STACK_DIR: "/tmp/stack" },
      fs,
      "/home/test"
    );

    expect(context.projectDir).toBe("/tmp/stack");
    expect(context.composeFilePath).toBe("/tmp/stack/docker-compose.yml");
  });

  it("uses MEMORYMESH_COMPOSE_FILE when provided", () => {
    const fs: IFileSystem = {
      exists: (path) => path === "/tmp/stack/custom.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext(
      "/tmp/current",
      { MEMORYMESH_COMPOSE_FILE: "/tmp/stack/custom.yml" },
      fs,
      "/home/test"
    );

    expect(context.projectDir).toBe("/tmp/stack");
    expect(context.composeFilePath).toBe("/tmp/stack/custom.yml");
  });

  it("keeps Windows absolute compose path without cwd prefixing", () => {
    const fs: IFileSystem = {
      exists: (path) => path === "C:\\stack\\docker-compose.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext(
      "/tmp/current",
      { MEMORYMESH_COMPOSE_FILE: "C:\\stack\\docker-compose.yml" },
      fs,
      "C:\\Users\\Test"
    );

    expect(context.projectDir).toBe("C:\\stack");
    expect(context.composeFilePath).toBe("C:\\stack\\docker-compose.yml");
  });

  it("keeps Windows absolute stack dir without cwd prefixing", () => {
    const fs: IFileSystem = {
      exists: (path) => path === "C:\\stack\\docker-compose.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext(
      "/tmp/current",
      { MEMORYMESH_STACK_DIR: "C:\\stack" },
      fs,
      "C:\\Users\\Test"
    );

    expect(context.projectDir).toBe("C:\\stack");
    expect(context.composeFilePath).toBe("C:\\stack\\docker-compose.yml");
  });

  it("finds compose file by walking up from cwd", () => {
    const fs: IFileSystem = {
      exists: (path) => path === "/tmp/docker-compose.yml",
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    const context = resolveStackContext("/tmp/a/b/c", {}, fs, "/home/test");
    expect(context.projectDir).toBe("/tmp");
    expect(context.composeFilePath).toBe("/tmp/docker-compose.yml");
  });

  it("throws clear error when compose cannot be resolved", () => {
    const fs: IFileSystem = {
      exists: () => false,
      mkdir: async () => {},
      read: async () => "",
      write: async () => {},
    };

    expect(() => resolveStackContext("/tmp/current", {}, fs, "/home/test")).toThrow(
      "Unable to resolve stack definition"
    );
  });
});
