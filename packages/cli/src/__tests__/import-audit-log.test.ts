import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ImportAuditLog } from "../import-audit-log";

describe("import-audit-log", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memorymesh-audit-log-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates audit directory/file with restricted permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    const directory = join(root, "audit");
    const log = new ImportAuditLog(
      {
        mode: "real",
        project: "MemoryMesh",
        input_path: "/tmp/in",
        engine: "ts",
        import_policy: "skip_existing",
      },
      {
        enabled: true,
        directory,
      }
    );

    log.writeEvent("run_started", { ok: true });
    await log.close();

    const filePath = log.getPath();
    expect(filePath).toBeDefined();

    const dirMode = statSync(directory).mode & 0o777;
    const fileMode = statSync(filePath as string).mode & 0o777;
    expect(dirMode & 0o077).toBe(0);
    expect(fileMode & 0o077).toBe(0);
  });
});
