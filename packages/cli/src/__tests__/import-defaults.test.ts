import { mkdtemp, writeFile, utimes, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectLatestChatGptExportPath,
  expandHomePath,
  persistLastStartedDocumentImportPath,
  persistLastStartedChatGptImportPath,
  readLastStartedDocumentImportPath,
  readLastStartedChatGptImportPath,
} from "../commands/import-defaults";

describe("import defaults", () => {
  it("expands home path", () => {
    expect(expandHomePath("~/Downloads/a.json", "/home/test")).toBe(
      "/home/test/Downloads/a.json"
    );
  });

  it("expands Windows-style home path separators", () => {
    expect(expandHomePath("~\\Downloads\\a.json", "C:\\Users\\test")).toBe(
      "C:\\Users\\test/Downloads/a.json"
    );
  });

  it("detects latest chatgpt export file from Downloads", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "mm-import-defaults-"));
    const downloads = join(homeDir, "Downloads");
    await mkdir(downloads, { recursive: true });

    const older = join(downloads, "old.json");
    const newer = join(downloads, "chatgpt-latest.zip");
    await writeFile(older, "{}");
    await writeFile(newer, "zip");
    const now = Date.now() / 1000;
    await utimes(older, now - 20, now - 20);
    await utimes(newer, now, now);

    const detected = await detectLatestChatGptExportPath(homeDir);
    expect(detected).toBe(newer);
  });

  it("returns null when no previously started import path is stored", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "mm-import-defaults-empty-"));
    const loaded = await readLastStartedChatGptImportPath(homeDir);
    expect(loaded).toBeNull();
  });

  it("persists and reads last started import path", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "mm-import-defaults-state-"));
    const path = join(homeDir, "Downloads", "chatgpt-latest.zip");
    await persistLastStartedChatGptImportPath(homeDir, path);
    const loaded = await readLastStartedChatGptImportPath(homeDir);
    expect(loaded).toBe(path);
  });

  it("persists and reads last started document import path", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "mm-doc-import-defaults-state-"));
    const path = join(homeDir, "Documents", "knowledge");
    await persistLastStartedDocumentImportPath(homeDir, path);
    const loaded = await readLastStartedDocumentImportPath(homeDir);
    expect(loaded).toBe(path);
  });

  it("keeps chatgpt and document import paths together in same state file", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "mm-import-defaults-shared-"));
    const chatPath = join(homeDir, "Downloads", "chatgpt.zip");
    const docPath = join(homeDir, "Documents", "docs");
    await persistLastStartedChatGptImportPath(homeDir, chatPath);
    await persistLastStartedDocumentImportPath(homeDir, docPath);

    const loadedChat = await readLastStartedChatGptImportPath(homeDir);
    const loadedDoc = await readLastStartedDocumentImportPath(homeDir);

    expect(loadedChat).toBe(chatPath);
    expect(loadedDoc).toBe(docPath);
  });
});
