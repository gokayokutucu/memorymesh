import { resolve } from "node:path";
import { IFileSystem, nodeFileSystem } from "../system/filesystem";
import { IStackContext } from "../system/stack-context";
import { joinFromHome } from "../system/runtime-home";

export type TStackMode = "release-image" | "local-dev-build";

export interface IInstallerManagedStackContext extends IStackContext {
  mode: TStackMode;
}

interface IStackComposeOptions {
  mode: TStackMode;
  localBuildContext?: string;
}

interface IStackModeOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function createMemoryMeshServiceContent(options: IStackComposeOptions): string {
  if (options.mode === "local-dev-build") {
    if (!options.localBuildContext) {
      throw new Error("Local build context is required for local-dev-build mode.");
    }

    return `  memorymesh:
    image: "memorymesh/server:local-dev"
    build:
      context: "${options.localBuildContext}"
      dockerfile: "apps/server/Dockerfile"
    depends_on:
      qdrant:
        condition: service_started
      ollama:
        condition: service_started
      ollama-model-init:
        condition: service_completed_successfully
      mongodb:
        condition: service_started
      neo4j:
        condition: service_started
    ports:
      - "\${HTTP_PORT:-3456}:\${HTTP_PORT:-3456}"
    environment:
      - TRANSPORT=http
      - HTTP_PORT=\${HTTP_PORT:-3456}
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OLLAMA_HOST=ollama
      - OLLAMA_PORT=11434
      - EMBEDDING_MODEL=\${EMBEDDING_MODEL}
      - MEMORYMESH_EMBEDDING_MODE=\${MEMORYMESH_EMBEDDING_MODE}
      - MEMORYMESH_EMBEDDING_DIMENSION=\${MEMORYMESH_EMBEDDING_DIMENSION}
      - QDRANT_COLLECTION=memories
      - MONGO_HOST=mongodb
      - MONGO_PORT=27017
      - MONGO_DB=memorymesh
      - NEO4J_URI=bolt://neo4j:7687
    restart: unless-stopped`;
  }

  return `  memorymesh:
    image: "\${MEMORYMESH_SERVER_IMAGE:-ghcr.io/memorymesh/server:latest}"
    depends_on:
      qdrant:
        condition: service_started
      ollama:
        condition: service_started
      ollama-model-init:
        condition: service_completed_successfully
      mongodb:
        condition: service_started
      neo4j:
        condition: service_started
    ports:
      - "\${HTTP_PORT:-3456}:\${HTTP_PORT:-3456}"
    environment:
      - TRANSPORT=http
      - HTTP_PORT=\${HTTP_PORT:-3456}
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OLLAMA_HOST=ollama
      - OLLAMA_PORT=11434
      - EMBEDDING_MODEL=\${EMBEDDING_MODEL}
      - MEMORYMESH_EMBEDDING_MODE=\${MEMORYMESH_EMBEDDING_MODE}
      - MEMORYMESH_EMBEDDING_DIMENSION=\${MEMORYMESH_EMBEDDING_DIMENSION}
      - QDRANT_COLLECTION=memories
      - MONGO_HOST=mongodb
      - MONGO_PORT=27017
      - MONGO_DB=memorymesh
      - NEO4J_URI=bolt://neo4j:7687
    restart: unless-stopped`;
}

function createStackComposeContent(options: IStackComposeOptions): string {
  const memoryMeshService = createMemoryMeshServiceContent(options);
  return `services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_storage:/qdrant/storage
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_models:/root/.ollama
    restart: unless-stopped

  ollama-model-init:
    image: ollama/ollama:latest
    depends_on:
      - ollama
    environment:
      - OLLAMA_HOST=http://ollama:11434
      - EMBEDDING_MODEL=\${EMBEDDING_MODEL}
    entrypoint:
      - /bin/sh
      - -c
      - |
        set -eu
        echo "[ollama-model-init] waiting for ollama..."
        until ollama list >/dev/null 2>&1; do sleep 2; done
        echo "[ollama-model-init] pulling model: $$EMBEDDING_MODEL"
        ollama pull "$$EMBEDDING_MODEL"
        echo "[ollama-model-init] model ready: $$EMBEDDING_MODEL"
    restart: "no"

  mongodb:
    image: mongo:7
    ports:
      - "\${MONGO_PORT:-27017}:27017"
    environment:
      - MONGO_INITDB_DATABASE=memorymesh
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

  neo4j:
    image: neo4j:5
    ports:
      - "\${NEO4J_HTTP_PORT:-7474}:7474"
      - "\${NEO4J_BOLT_PORT:-7687}:7687"
    environment:
      - NEO4J_AUTH=none
    volumes:
      - neo4j_data:/data
    restart: unless-stopped

${memoryMeshService}

volumes:
  qdrant_storage:
  ollama_models:
  mongodb_data:
  neo4j_data:
`;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return undefined;
}

function resolveLocalBuildContext(cwd: string, fs: IFileSystem): string | null {
  const dockerfilePath = resolve(cwd, "apps", "server", "Dockerfile");
  const packageJsonPath = resolve(cwd, "package.json");
  if (!fs.exists(dockerfilePath) || !fs.exists(packageJsonPath)) {
    return null;
  }

  return cwd;
}

export function resolveStackMode(
  fs: IFileSystem,
  options: IStackModeOptions = {}
): IStackComposeOptions {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const envToggle = parseBooleanEnv(env.MEMORYMESH_USE_LOCAL_BUILD);

  if (envToggle === false) {
    return { mode: "release-image" };
  }

  if (envToggle === true) {
    const localBuildContext = resolveLocalBuildContext(cwd, fs);
    if (!localBuildContext) {
      throw new Error(
        "MEMORYMESH_USE_LOCAL_BUILD=true requires repository root containing apps/server/Dockerfile."
      );
    }

    return {
      mode: "local-dev-build",
      localBuildContext,
    };
  }

  const autoContext = resolveLocalBuildContext(cwd, fs);
  if (autoContext) {
    return {
      mode: "local-dev-build",
      localBuildContext: autoContext,
    };
  }

  return { mode: "release-image" };
}

export function getInstallerManagedStackDir(homeDir: string): string {
  return joinFromHome(homeDir, ".memorymesh", "stack");
}

export function getInstallerHomeDir(homeDir: string): string {
  return joinFromHome(homeDir, ".memorymesh");
}

export function getInstallerManagedComposePath(homeDir: string): string {
  return joinFromHome(getInstallerHomeDir(homeDir), "stack", "docker-compose.yml");
}

export async function ensureInstallerManagedStack(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem,
  options: IStackModeOptions = {}
): Promise<IInstallerManagedStackContext> {
  const stackDir = getInstallerManagedStackDir(homeDir);
  const composeFilePath = getInstallerManagedComposePath(homeDir);
  const mode = resolveStackMode(fs, options);

  await fs.mkdir(stackDir);
  await fs.write(composeFilePath, createStackComposeContent(mode));

  return {
    projectDir: stackDir,
    composeFilePath,
    mode: mode.mode,
  };
}

export function resolveInstallerManagedStack(
  homeDir: string,
  fs: IFileSystem = nodeFileSystem
): IInstallerManagedStackContext | null {
  const composeFilePath = getInstallerManagedComposePath(homeDir);
  if (!fs.exists(composeFilePath)) {
    return null;
  }

  return {
    projectDir: getInstallerManagedStackDir(homeDir),
    composeFilePath,
    mode: "release-image",
  };
}
