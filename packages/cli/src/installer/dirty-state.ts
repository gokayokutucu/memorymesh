import { join } from "node:path";
import { getInstallerHomeDir, getInstallerManagedComposePath } from "./stack-packaging";
import { ICommandRunner } from "../system/command-runner";
import { IFileSystem } from "../system/filesystem";
import { checkServiceRunning } from "../system/docker";
import { IStackContext } from "../system/stack-context";

export interface IDirtyStateSignals {
  homeDirExists: boolean;
  stackComposeExists: boolean;
  qdrantHasCollections: boolean;
  mongoHasDocuments: boolean;
  neo4jHasNodes: boolean;
}

export interface IDirtyStateReport {
  hasDirtyState: boolean;
  signals: IDirtyStateSignals;
  details: string[];
}

function getManagedStackContext(homeDir: string): IStackContext {
  return {
    projectDir: join(getInstallerHomeDir(homeDir), "stack"),
    composeFilePath: getInstallerManagedComposePath(homeDir),
  };
}

async function detectQdrantCollections(
  runner: ICommandRunner
): Promise<boolean> {
  const result = await runner.run("curl", [
    "-fsS",
    "http://localhost:6333/collections",
  ]);
  if (!result.success) {
    return false;
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      result?: { collections?: Array<{ name?: string }> };
    };
    const collections = parsed.result?.collections ?? [];
    return collections.length > 0;
  } catch {
    return false;
  }
}

async function detectMongoDocuments(
  runner: ICommandRunner,
  context: IStackContext
): Promise<boolean> {
  const result = await runner.run("docker", [
    "compose",
    "-f",
    context.composeFilePath,
    "--project-directory",
    context.projectDir,
    "exec",
    "-T",
    "mongodb",
    "mongosh",
    "--quiet",
    "--eval",
    "db.getSiblingDB('memorymesh').stats().objects",
  ]);
  if (!result.success) {
    return false;
  }

  const match = result.stdout.match(/(\d+)/);
  if (!match) {
    return false;
  }

  return Number(match[1]) > 0;
}

async function detectNeo4jNodes(
  runner: ICommandRunner,
  context: IStackContext
): Promise<boolean> {
  const result = await runner.run("docker", [
    "compose",
    "-f",
    context.composeFilePath,
    "--project-directory",
    context.projectDir,
    "exec",
    "-T",
    "neo4j",
    "cypher-shell",
    "MATCH (n) RETURN count(n) AS c;",
  ]);
  if (!result.success) {
    return false;
  }

  const allNumbers = result.stdout.match(/(\d+)/g);
  if (!allNumbers || allNumbers.length === 0) {
    return false;
  }

  const last = Number(allNumbers[allNumbers.length - 1]);
  return Number.isFinite(last) && last > 0;
}

function buildDetails(signals: IDirtyStateSignals): string[] {
  const details: string[] = [];
  if (signals.homeDirExists) {
    details.push("Existing MemoryMesh home directory detected.");
  }
  if (signals.stackComposeExists) {
    details.push("Existing installer-managed compose file detected.");
  }
  if (signals.qdrantHasCollections) {
    details.push("Qdrant collections detected.");
  }
  if (signals.mongoHasDocuments) {
    details.push("MongoDB memorymesh database already contains documents.");
  }
  if (signals.neo4jHasNodes) {
    details.push("Neo4j already contains graph nodes.");
  }
  return details;
}

export async function inspectDirtySetupState(
  homeDir: string,
  fs: IFileSystem,
  runner: ICommandRunner
): Promise<IDirtyStateReport> {
  const homePath = getInstallerHomeDir(homeDir);
  const composePath = getInstallerManagedComposePath(homeDir);
  const homeDirExists = fs.exists(homePath);
  const stackComposeExists = fs.exists(composePath);

  let qdrantHasCollections = false;
  let mongoHasDocuments = false;
  let neo4jHasNodes = false;

  qdrantHasCollections = await detectQdrantCollections(runner);

  if (stackComposeExists) {
    const stackContext = getManagedStackContext(homeDir);

    const mongoRunning = await checkServiceRunning(runner, stackContext, "mongodb");
    if (mongoRunning.ok) {
      mongoHasDocuments = await detectMongoDocuments(runner, stackContext);
    }

    const neo4jRunning = await checkServiceRunning(runner, stackContext, "neo4j");
    if (neo4jRunning.ok) {
      neo4jHasNodes = await detectNeo4jNodes(runner, stackContext);
    }
  }

  const signals: IDirtyStateSignals = {
    homeDirExists,
    stackComposeExists,
    qdrantHasCollections,
    mongoHasDocuments,
    neo4jHasNodes,
  };
  const details = buildDetails(signals);

  return {
    hasDirtyState: details.length > 0,
    signals,
    details,
  };
}
