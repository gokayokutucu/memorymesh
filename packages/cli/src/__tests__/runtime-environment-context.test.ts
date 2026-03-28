import {
  applyRuntimeEnvironmentBootstrap,
  resolveRuntimeEnvironmentContext,
} from "../installer/runtime-environment-context";
import { IFileSystem } from "../system/filesystem";

function createFs(files: Record<string, string>): IFileSystem {
  return {
    exists: (path: string) => Object.prototype.hasOwnProperty.call(files, path),
    mkdir: async () => {},
    read: async (path: string) => {
      const value = files[path];
      if (typeof value === "undefined") {
        throw new Error(`Missing file: ${path}`);
      }
      return value;
    },
    write: async () => {},
  };
}

describe("runtime environment bootstrap policy", () => {
  it("uses runtime.env in installed-cli mode", async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = createFs({
      "/tmp/home/.memorymesh/runtime.env":
        "EMBEDDING_MODEL=mxbai-embed-large\nMEMORYMESH_EMBEDDING_MODE=medium\nMEMORYMESH_EMBEDDING_DIMENSION=1024\n",
    });

    const resolved = await applyRuntimeEnvironmentBootstrap({
      homeDir: "/tmp/home",
      env,
      fs,
    });

    expect(resolved.context.mode).toBe("installed-cli");
    expect(env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
    expect(env.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
    expect(env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
  });

  it("prefers cloud env values over runtime.env in hosted mode", async () => {
    const env: NodeJS.ProcessEnv = {
      RAILWAY_ENVIRONMENT: "production",
      EMBEDDING_MODEL: "mxbai-embed-large",
      MONGO_USER: "railway-user",
      MONGO_PASSWORD: "railway-pass",
    };
    const fs = createFs({
      "/tmp/home/.memorymesh/runtime.env":
        "EMBEDDING_MODEL=nomic-embed-text\nMONGO_USER=local-user\nMONGO_PASSWORD=local-pass\n",
    });

    const resolved = await applyRuntimeEnvironmentBootstrap({
      homeDir: "/tmp/home",
      env,
      fs,
    });

    expect(resolved.context.mode).toBe("hosted-cloud");
    expect(env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
    expect(env.MONGO_USER).toBe("railway-user");
    expect(env.MONGO_PASSWORD).toBe("railway-pass");
  });

  it("keeps external secrets authoritative in local-dev mode", async () => {
    const env: NodeJS.ProcessEnv = {
      MEMORYMESH_USE_LOCAL_BUILD: "true",
      MONGO_USER: "external-user",
      MONGO_PASSWORD: "external-password",
    };
    const fs = createFs({
      "/tmp/home/.memorymesh/runtime.env":
        "MONGO_USER=runtime-user\nMONGO_PASSWORD=runtime-password\nEMBEDDING_MODEL=nomic-embed-text\n",
    });

    await applyRuntimeEnvironmentBootstrap({
      homeDir: "/tmp/home",
      env,
      fs,
    });

    expect(resolveRuntimeEnvironmentContext(env).mode).toBe("local-dev");
    expect(env.MONGO_USER).toBe("external-user");
    expect(env.MONGO_PASSWORD).toBe("external-password");
  });
});
