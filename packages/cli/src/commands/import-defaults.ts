import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

interface IImportState {
  lastStartedChatGptImportPath?: string;
  lastStartedDocumentImportPath?: string;
}

function getImportStatePath(homeDir: string): string {
  return join(homeDir, ".memorymesh", "import-state.json");
}

export function expandHomePath(inputPath: string, homeDir: string): string {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    const remainder = inputPath.slice(2);
    const segments = remainder.split(/[\\/]+/).filter((segment) => segment.length > 0);
    return join(homeDir, ...segments);
  }

  return inputPath;
}

export async function detectLatestChatGptExportPath(
  homeDir: string
): Promise<string | null> {
  const downloadsDir = join(homeDir, "Downloads");
  let entries: string[];
  try {
    entries = await readdir(downloadsDir);
  } catch {
    return null;
  }

  const candidates = entries.filter((name) => {
    const lower = name.toLowerCase();
    return lower.endsWith(".json") || (lower.includes("chatgpt") && lower.endsWith(".zip"));
  });

  if (candidates.length === 0) {
    return null;
  }

  const withTimes = await Promise.all(
    candidates.map(async (name) => {
      const fullPath = join(downloadsDir, name);
      const info = await stat(fullPath);
      return {
        fullPath,
        mtimeMs: info.mtimeMs,
      };
    })
  );

  withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withTimes[0]?.fullPath ?? null;
}

export async function readLastStartedChatGptImportPath(
  homeDir: string
): Promise<string | null> {
  const statePath = getImportStatePath(homeDir);
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as IImportState;
    const path = parsed.lastStartedChatGptImportPath;
    if (typeof path !== "string" || path.trim().length === 0) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export async function persistLastStartedChatGptImportPath(
  homeDir: string,
  inputPath: string
): Promise<void> {
  const previous = await readImportStateOrEmpty(homeDir);
  const state: IImportState = {
    ...previous,
    lastStartedChatGptImportPath: inputPath,
  };
  await writeImportState(homeDir, state);
}

export async function readLastStartedDocumentImportPath(
  homeDir: string
): Promise<string | null> {
  try {
    const parsed = await readImportState(homeDir);
    const path = parsed.lastStartedDocumentImportPath;
    if (typeof path !== "string" || path.trim().length === 0) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export async function persistLastStartedDocumentImportPath(
  homeDir: string,
  inputPath: string
): Promise<void> {
  const previous = await readImportStateOrEmpty(homeDir);
  const state: IImportState = {
    ...previous,
    lastStartedDocumentImportPath: inputPath,
  };
  await writeImportState(homeDir, state);
}

async function readImportState(homeDir: string): Promise<IImportState> {
  const statePath = getImportStatePath(homeDir);
  const raw = await readFile(statePath, "utf-8");
  const parsed = JSON.parse(raw) as IImportState;
  return parsed;
}

async function readImportStateOrEmpty(homeDir: string): Promise<IImportState> {
  try {
    return await readImportState(homeDir);
  } catch {
    return {};
  }
}

async function writeImportState(homeDir: string, state: IImportState): Promise<void> {
  const statePath = getImportStatePath(homeDir);
  await mkdir(join(homeDir, ".memorymesh"), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}
