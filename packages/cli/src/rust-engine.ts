import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { IGptConversation } from "@memorymesh/core";
import { JsonFileCategory } from "./json-shape-classifier";

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

interface IExecResult {
  stdout: string;
  stderr: string;
}

export async function runRustImporterEngine(
  inputPath: string,
  binaryPath?: string
): Promise<IRustEngineOutput> {
  const rustBinary =
    binaryPath ??
    process.env.MEMORYMESH_RUST_ENGINE_BIN ??
    resolveDefaultRustBinaryPath();

  const result = await execFileAsync(rustBinary, [inputPath]);

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

function execFileAsync(command: string, args: string[]): Promise<IExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { maxBuffer: 128 * 1024 * 1024 }, (error, stdout, stderr) => {
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
    });
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
