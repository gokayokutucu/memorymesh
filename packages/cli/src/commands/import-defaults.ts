import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

interface IImportState {
  lastStartedChatGptImportPath?: string;
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
  const statePath = getImportStatePath(homeDir);
  await mkdir(join(homeDir, ".memorymesh"), { recursive: true });
  const state: IImportState = {
    lastStartedChatGptImportPath: inputPath,
  };
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}
