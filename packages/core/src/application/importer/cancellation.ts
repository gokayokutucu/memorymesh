export type ImportInterruptReason = "signal" | "debug_stop" | "cancelled";

export interface ICancellationToken {
  readonly isCancelled: boolean;
  cancel(): void;
  throwIfCancelled(signal?: NodeJS.Signals): void;
}

export class ImportInterruptedError extends Error {
  readonly code = "import_interrupted";
  readonly signal?: NodeJS.Signals;
  readonly reason: ImportInterruptReason;

  constructor(reason: ImportInterruptReason = "cancelled", signal?: NodeJS.Signals) {
    super(
      reason === "signal"
        ? `Import interrupted by ${signal ?? "signal"}`
        : reason === "debug_stop"
          ? "Import interrupted by debug stop threshold"
          : "Import interrupted"
    );
    this.name = "ImportInterruptedError";
    this.reason = reason;
    this.signal = signal;
  }
}

export class CancellationToken implements ICancellationToken {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  throwIfCancelled(signal?: NodeJS.Signals): void {
    if (this.cancelled) {
      throw new ImportInterruptedError("signal", signal);
    }
  }
}
