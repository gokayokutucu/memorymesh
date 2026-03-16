import { Dirent, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { IGptConversation } from "@memorymesh/core";
import {
  classifyJsonFileContent,
  IJsonFileClassification,
  JsonFileCategory,
} from "./json-shape-classifier";

export interface IScannedJsonFile extends IJsonFileClassification {
  path: string;
  content?: string;
  conversations?: IGptConversation[];
}

export interface IScanReport {
  files: IScannedJsonFile[];
  counts: Record<JsonFileCategory, number>;
  scanned_json_files: number;
}

export function scanJsonInputPath(inputPath: string): IScanReport {
  const normalizedPath = resolve(inputPath);
  const jsonFiles = collectJsonFiles(normalizedPath);
  const files: IScannedJsonFile[] = [];
  const counts = buildCategoryCounter();

  for (const jsonPath of jsonFiles) {
    const content = readFileSync(jsonPath, "utf-8");
    const classification = classifyJsonFileContent(jsonPath, content);
    counts[classification.category] += 1;
    files.push({
      path: jsonPath,
      ...classification,
      content:
        classification.category === "supported_conversation_file" ? content : undefined,
    });
  }

  return {
    files,
    counts,
    scanned_json_files: jsonFiles.length,
  };
}

function collectJsonFiles(entryPath: string): string[] {
  if (extname(entryPath).toLowerCase() === ".json") {
    return [entryPath];
  }

  const results: string[] = [];
  const entries = readdirSync(entryPath, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const childPath = resolve(entryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(childPath));
      continue;
    }

    if (isJsonFile(entry)) {
      results.push(childPath);
    }
  }

  return results.sort();
}

function isJsonFile(entry: Dirent): boolean {
  return entry.isFile() && extname(entry.name).toLowerCase() === ".json";
}

function buildCategoryCounter(): Record<JsonFileCategory, number> {
  return {
    supported_conversation_file: 0,
    unsupported_conversation_schema: 0,
    ignorable_json: 0,
    unknown_json: 0,
    invalid_json: 0,
  };
}
