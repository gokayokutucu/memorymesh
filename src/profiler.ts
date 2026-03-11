export interface ITimingEntry {
  label: string;
  duration_ms: number;
}

export class Profiler {
  private readonly entries: ITimingEntry[] = [];

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.entries.push({
        label,
        duration_ms: Date.now() - start,
      });
    }
  }

  report(): ITimingEntry[] {
    return [...this.entries];
  }

  summary(): string {
    const parts = this.entries.map((entry) =>
      `${entry.label}: ${entry.duration_ms}ms`
    );
    const total = this.entries.reduce(
      (acc, entry) => acc + entry.duration_ms,
      0
    );
    return `[profiler] ${parts.join(" | ")} | total: ${total}ms`;
  }
}
