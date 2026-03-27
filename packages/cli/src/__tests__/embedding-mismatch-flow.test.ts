import {
  runEmbeddingMismatchFlow,
} from "../installer/embedding-mismatch-flow";
import { ApprovalOptions, IApprovalUi } from "../ui/approval";

class FakeApprovalUi implements IApprovalUi {
  calls = 0;

  constructor(
    private readonly result: "approved" | "rejected" | "cancelled"
  ) {}

  async promptApproval(_options: ApprovalOptions): Promise<
    { status: "approved" } | { status: "rejected" } | { status: "cancelled" }
  > {
    this.calls += 1;
    return { status: this.result };
  }
}

describe("embedding mismatch flow", () => {
  it("skips approval when dimensions already match", async () => {
    const ui = new FakeApprovalUi("approved");
    const reset = jest.fn<Promise<void>, []>(async () => {});

    const result = await runEmbeddingMismatchFlow({
      existingDimension: 1024,
      selectedDimension: 1024,
      selectedMode: "medium",
      selectedModel: "mxbai-embed-large",
      ui,
      onApprovedReset: reset,
    });

    expect(result.status).toBe("no_mismatch");
    expect(ui.calls).toBe(0);
    expect(reset).not.toHaveBeenCalled();
  });

  it("runs reset when mismatch is approved", async () => {
    const ui = new FakeApprovalUi("approved");
    const reset = jest.fn<Promise<void>, []>(async () => {});

    const result = await runEmbeddingMismatchFlow({
      existingDimension: 768,
      selectedDimension: 1024,
      selectedMode: "medium",
      selectedModel: "mxbai-embed-large",
      ui,
      onApprovedReset: reset,
    });

    expect(result.status).toBe("approved");
    expect(ui.calls).toBe(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not reset when mismatch is rejected", async () => {
    const ui = new FakeApprovalUi("rejected");
    const reset = jest.fn<Promise<void>, []>(async () => {});

    const result = await runEmbeddingMismatchFlow({
      existingDimension: 768,
      selectedDimension: 1024,
      selectedMode: "medium",
      selectedModel: "mxbai-embed-large",
      ui,
      onApprovedReset: reset,
    });

    expect(result.status).toBe("rejected");
    expect(reset).not.toHaveBeenCalled();
  });

  it("does not reset when mismatch is cancelled", async () => {
    const ui = new FakeApprovalUi("cancelled");
    const reset = jest.fn<Promise<void>, []>(async () => {});

    const result = await runEmbeddingMismatchFlow({
      existingDimension: 768,
      selectedDimension: 1024,
      selectedMode: "medium",
      selectedModel: "mxbai-embed-large",
      ui,
      onApprovedReset: reset,
    });

    expect(result.status).toBe("cancelled");
    expect(reset).not.toHaveBeenCalled();
  });
});
