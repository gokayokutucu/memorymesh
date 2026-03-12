import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importFromPath } from "../folder-import";

describe("folder-import", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memorymesh-cli-import-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("routes only supported conversation files into importer and summarizes counts", async () => {
    writeFileSync(
      join(root, "supported.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    writeFileSync(
      join(root, "group_chats.json"),
      JSON.stringify({ chats: [{ messages: [{ text: "hi" }] }] }),
      "utf-8"
    );
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ manifest: true }), "utf-8");
    writeFileSync(join(root, "unknown.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    writeFileSync(join(root, "broken.json"), "{broken", "utf-8");

    const parse = jest.fn(() => [
      { title: "c1", messages: [{ role: "assistant", content: "x" }] },
      { title: "c2", messages: [{ role: "assistant", content: "y" }] },
    ]);

    const importer = jest.fn(async () => ({
      totalConversations: 2,
      saved: 3,
      skipped: 1,
      skippedReasons: { duplicate_ref_id: 1 },
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: false,
        delayMs: 0,
      },
      { parse, importer }
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(summary.scannedJsonFiles).toBe(5);
    expect(summary.supportedConversationFiles).toBe(1);
    expect(summary.importedConversations).toBe(2);
    expect(summary.savedMemories).toBe(3);
    expect(summary.skippedMemories).toBe(1);
    expect(summary.categories.unsupported_conversation_schema).toBe(1);
    expect(summary.categories.ignorable_json).toBe(1);
    expect(summary.categories.unknown_json).toBe(1);
    expect(summary.categories.invalid_json).toBe(1);
    expect(summary.skipReasons.duplicate_ref_id).toBe(1);
  });

  it("respects global conversation limit across supported files", async () => {
    writeFileSync(
      join(root, "supported-a.json"),
      JSON.stringify([{ mapping: { a: {} }, current_node: "a" }]),
      "utf-8"
    );
    writeFileSync(
      join(root, "supported-b.json"),
      JSON.stringify([{ mapping: { b: {} }, current_node: "b" }]),
      "utf-8"
    );

    const parse = jest
      .fn()
      .mockReturnValueOnce([
        { title: "c1", messages: [{ role: "assistant", content: "x" }] },
      ])
      .mockReturnValueOnce([
        { title: "c2", messages: [{ role: "assistant", content: "y" }] },
      ]);

    const importer = jest.fn(async (conversations: unknown[]) => ({
      totalConversations: conversations.length,
      saved: conversations.length,
      skipped: 0,
      skippedReasons: {},
    }));

    const summary = await importFromPath(
      root,
      {
        project: "MemoryMesh",
        dryRun: true,
        delayMs: 0,
        limit: 1,
      },
      { parse, importer }
    );

    expect(importer).toHaveBeenCalledTimes(1);
    expect(summary.importedConversations).toBe(1);
    expect(summary.savedMemories).toBe(1);
  });
});
