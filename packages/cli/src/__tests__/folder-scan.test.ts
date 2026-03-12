import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanJsonInputPath } from "../folder-scan";

describe("folder-scan", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memorymesh-cli-scan-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("recursively scans json files and classifies them", () => {
    const nested = join(root, "nested");
    mkdirSync(nested);

    writeFileSync(
      join(root, "conversations.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    writeFileSync(
      join(nested, "group_chats.json"),
      JSON.stringify({ chats: [{ messages: [1] }] }),
      "utf-8"
    );
    writeFileSync(join(nested, "manifest.json"), JSON.stringify({ manifest: true }), "utf-8");
    writeFileSync(join(root, "unknown.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    writeFileSync(join(root, "broken.json"), "{ broken", "utf-8");
    writeFileSync(join(root, "notes.txt"), "ignore", "utf-8");

    const report = scanJsonInputPath(root);

    expect(report.scanned_json_files).toBe(5);
    expect(report.counts.supported_conversation_file).toBe(1);
    expect(report.counts.unsupported_conversation_schema).toBe(1);
    expect(report.counts.ignorable_json).toBe(1);
    expect(report.counts.unknown_json).toBe(1);
    expect(report.counts.invalid_json).toBe(1);
  });

  it("supports direct single json file path", () => {
    const jsonFile = join(root, "one.json");
    writeFileSync(
      jsonFile,
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );

    const report = scanJsonInputPath(jsonFile);

    expect(report.scanned_json_files).toBe(1);
    expect(report.counts.supported_conversation_file).toBe(1);
  });
});
