import { createWriteStream, mkdirSync, WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { resolveUserHomeDir } from "./system/runtime-home";

interface IAuditRunContext {
  mode: "dry_run" | "real";
  project: string;
  input_path: string;
  engine: "ts" | "rust";
  import_policy: string;
}

interface IAuditLoggerOptions {
  enabled?: boolean;
  directory?: string;
}

export type AuditEventName =
  | "run_started"
  | "run_interrupted"
  | "run_completed"
  | "run_failed"
  | "scan_started"
  | "scan_completed"
  | "file_started"
  | "file_completed"
  | "conversation_started"
  | "conversation_completed"
  | "message_imported"
  | "message_skipped"
  | "message_stage_changed"
  | "checkpoint_loaded"
  | "checkpoint_advanced"
  | "checkpoint_reset"
  | "warning"
  | "error";

export class ImportAuditLog {
  private readonly context: IAuditRunContext;
  private readonly directory: string;
  private enabled: boolean;
  private stream: WriteStream | null = null;
  private filePath?: string;
  private warned = false;

  constructor(context: IAuditRunContext, options?: IAuditLoggerOptions) {
    this.context = context;
    this.directory =
      options?.directory ??
      process.env.MEMORYMESH_IMPORT_AUDIT_DIR ??
      resolve(resolveUserHomeDir(process.platform, process.env), ".memorymesh", "import-audit");
    this.enabled =
      options?.enabled ?? resolveAuditEnabledByDefault(context.mode);
    this.initialize();
  }

  getPath(): string | undefined {
    return this.filePath;
  }

  isEnabled(): boolean {
    return this.enabled && this.stream !== null;
  }

  writeEvent(event: AuditEventName, payload: Record<string, unknown> = {}): void {
    if (!this.isEnabled()) {
      return;
    }
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      ...this.context,
      ...payload,
    };

    try {
      this.stream!.write(`${JSON.stringify(entry)}\n`);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  close(): Promise<void> {
    if (!this.stream) {
      return Promise.resolve();
    }

    const active = this.stream;
    this.stream = null;
    return new Promise((resolvePromise) => {
      active.end(() => resolvePromise());
    });
  }

  private initialize(): void {
    if (!this.enabled) {
      return;
    }

    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");
      this.filePath = join(
        this.directory,
        `gpt-import-${this.context.mode}-${timestamp}.jsonl`
      );
      this.stream = createWriteStream(this.filePath, {
        flags: "a",
        encoding: "utf8",
        mode: 0o600,
      });
      this.stream.on("error", (error) => {
        this.handleFailure(error);
      });
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private handleFailure(error: unknown): void {
    this.enabled = false;
    try {
      this.stream?.destroy();
    } catch {
      // ignore stream destroy errors
    }
    this.stream = null;
    if (this.warned) {
      return;
    }
    this.warned = true;
    console.warn(
      `[audit] import audit logging disabled: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function resolveAuditEnabledByDefault(mode: "dry_run" | "real"): boolean {
  const raw = process.env.MEMORYMESH_IMPORT_AUDIT_ENABLED;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return mode === "real";
}
