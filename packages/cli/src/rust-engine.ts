import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { IGptConversation } from "@memorymesh/core";
import { JsonFileCategory } from "./json-shape-classifier";

interface IDocumentImportLimitsInput {
  max_file_size_mb: number;
  max_chars_per_file: number;
  max_chunks_per_file: number;
  chunk_size: number;
  chunk_overlap: number;
}

export interface IRustEngineFileResult {
  path: string;
  category: JsonFileCategory;
  reason: string;
  conversations?: IGptConversation[];
}

export interface IRustEngineOutput {
  scan_summary: {
    scanned_json_files: number;
    supported_conversation_file: number;
    unsupported_conversation_schema: number;
    ignorable_json: number;
    unknown_json: number;
    invalid_json: number;
  };
  files: IRustEngineFileResult[];
}

export interface IRustDocumentChunk {
  content: string;
  chunk_index: number;
  chunk_total: number;
}

export interface IRustDocumentFileResult {
  path: string;
  relative_path: string;
  extension: string;
  size_bytes: number;
  status: "supported" | "skipped";
  reason: string;
  chunks: IRustDocumentChunk[];
}

export interface IRustDocumentEngineOutput {
  scan_summary: {
    discovered_files: number;
    supported_files: number;
    skipped_files: number;
  };
  files: IRustDocumentFileResult[];
}

interface IExecResult {
  stdout: string;
  stderr: string;
}

export async function runRustImporterEngine(
  inputPath: string,
  binaryPath?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<IRustEngineOutput> {
  const rustBinary =
    binaryPath ??
    process.env.MEMORYMESH_RUST_ENGINE_BIN ??
    resolveDefaultRustBinaryPath();

  const result = await execFileAsync(rustBinary, [inputPath], env);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Rust importer engine returned malformed JSON output");
  }

  if (!isRustEngineOutput(parsed)) {
    throw new Error("Rust importer engine output does not match expected contract");
  }

  return parsed;
}

export async function runRustDocumentImporterEngine(
  inputPath: string,
  limits: IDocumentImportLimitsInput,
  binaryPath?: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<IRustDocumentEngineOutput> {
  const rustBinary =
    binaryPath ??
    process.env.MEMORYMESH_RUST_ENGINE_BIN ??
    resolveDefaultRustBinaryPath();
  const limitsJson = JSON.stringify(limits);
  const result = await execFileAsync(
    rustBinary,
    ["documents", inputPath, limitsJson],
    env
  );
  const initialStdoutPreview = toOutputPreview(result.stdout);

  let parsed = parseRustJsonOutput(
    result.stdout,
    "Rust document importer engine returned malformed JSON output"
  );
  if (isRustDocumentEngineOutput(parsed)) {
    return parsed;
  }

  // Legacy binaries (GPT scan schema only) return a different contract here.
  // Rebuild once and retry to ensure document mode output is aligned.
  if (isLegacyRustScanOutput(parsed)) {
    await rebuildRustImporterEngine(env);
    const rebuiltResult = await execFileAsync(
      rustBinary,
      ["documents", inputPath, limitsJson],
      env
    );
    const rebuiltStdoutPreview = toOutputPreview(rebuiltResult.stdout);
    parsed = parseRustJsonOutput(
      rebuiltResult.stdout,
      "Rust document importer engine returned malformed JSON output"
    );
    if (isRustDocumentEngineOutput(parsed)) {
      return parsed;
    }
    throw new Error(
      `Rust document importer engine output does not match expected contract after rebuild. ${summarizeRustOutputShape(parsed)} | stdout preview: ${rebuiltStdoutPreview}`
    );
  }

  throw new Error(
    `Rust document importer engine output does not match expected contract. ${summarizeRustOutputShape(parsed)} | stdout preview: ${initialStdoutPreview}`
  );
}

function execFileAsync(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<IExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: 128 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(
              new Error(
                `Rust importer engine binary not found: ${command}. Build it with: cargo build --manifest-path native/importer-engine/Cargo.toml`
              )
            );
            return;
          }

          reject(
            new Error(
              `Rust importer engine failed: ${error.message}${stderr ? `\n${stderr}` : ""}`
            )
          );
          return;
        }

        resolvePromise({ stdout, stderr });
      }
    );
  });
}

function resolveDefaultRustBinaryPath(): string {
  const candidates = [
    resolve(process.cwd(), "native/importer-engine/target/debug/importer-engine"),
    resolve(process.cwd(), "../native/importer-engine/target/debug/importer-engine"),
    resolve(process.cwd(), "../../native/importer-engine/target/debug/importer-engine"),
  ];

  const existing = candidates.find((path) => existsSync(path));
  return existing ?? candidates[0];
}

function resolveRustManifestPath(): string {
  const candidates = [
    resolve(process.cwd(), "native/importer-engine/Cargo.toml"),
    resolve(process.cwd(), "../native/importer-engine/Cargo.toml"),
    resolve(process.cwd(), "../../native/importer-engine/Cargo.toml"),
  ];
  const existing = candidates.find((path) => existsSync(path));
  return existing ?? candidates[0];
}

function isRustEngineOutput(value: unknown): value is IRustEngineOutput {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.scan_summary)) {
    return false;
  }

  if (!Array.isArray(value.files)) {
    return false;
  }

  return value.files.every((file) => {
    if (!isRecord(file)) {
      return false;
    }

    if (typeof file.path !== "string" || typeof file.reason !== "string") {
      return false;
    }

    if (!isJsonCategory(file.category)) {
      return false;
    }

    if (file.conversations !== undefined && !Array.isArray(file.conversations)) {
      return false;
    }

    return true;
  });
}

function isJsonCategory(value: unknown): value is JsonFileCategory {
  return (
    value === "supported_conversation_file" ||
    value === "unsupported_conversation_schema" ||
    value === "ignorable_json" ||
    value === "unknown_json" ||
    value === "invalid_json"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRustDocumentEngineOutput(
  value: unknown
): value is IRustDocumentEngineOutput {
  if (!isRecord(value) || !isRecord(value.scan_summary) || !Array.isArray(value.files)) {
    return false;
  }
  if (
    typeof value.scan_summary.discovered_files !== "number" ||
    typeof value.scan_summary.supported_files !== "number" ||
    typeof value.scan_summary.skipped_files !== "number"
  ) {
    return false;
  }

  return value.files.every((file) => {
    if (!isRecord(file)) {
      return false;
    }
    if (
      typeof file.path !== "string" ||
      typeof file.relative_path !== "string" ||
      typeof file.extension !== "string" ||
      typeof file.size_bytes !== "number" ||
      (file.status !== "supported" && file.status !== "skipped") ||
      typeof file.reason !== "string" ||
      !Array.isArray(file.chunks)
    ) {
      return false;
    }

    return file.chunks.every((chunk) => (
      isRecord(chunk) &&
      typeof chunk.content === "string" &&
      typeof chunk.chunk_index === "number" &&
      typeof chunk.chunk_total === "number"
    ));
  });
}

function isLegacyRustScanOutput(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.scan_summary)) {
    return false;
  }
  return (
    typeof value.scan_summary.scanned_json_files === "number" &&
    typeof value.scan_summary.supported_conversation_file === "number"
  );
}

function parseRustJsonOutput(stdout: string, baseMessage: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const preview = stdout.slice(0, 300).trim();
    if (!preview) {
      throw new Error(baseMessage);
    }
    throw new Error(`${baseMessage}. Output preview: ${preview}`);
  }
}

function toOutputPreview(stdout: string): string {
  const preview = stdout.replace(/\s+/g, " ").trim().slice(0, 300);
  return preview || "<empty>";
}

function summarizeRustOutputShape(value: unknown): string {
  if (!isRecord(value)) {
    return `Received root type: ${typeof value}`;
  }
  const keys = Object.keys(value).join(", ");
  if (isRecord(value.scan_summary)) {
    const summaryKeys = Object.keys(value.scan_summary).join(", ");
    return `Top-level keys: [${keys}] | scan_summary keys: [${summaryKeys}]`;
  }
  return `Top-level keys: [${keys}]`;
}

async function rebuildRustImporterEngine(env: NodeJS.ProcessEnv): Promise<void> {
  const manifestPath = resolveRustManifestPath();
  try {
    await execFileAsync(
      "cargo",
      ["build", "--manifest-path", manifestPath],
      env
    );
  } catch (error) {
    throw new Error(
      `Detected legacy Rust importer output contract. Rebuild failed at ${manifestPath}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
