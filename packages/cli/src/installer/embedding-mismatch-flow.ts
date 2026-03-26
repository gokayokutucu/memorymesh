import { IApprovalUi } from "../ui/approval";

export interface IEmbeddingMismatchFlowInput {
  existingDimension: number | null;
  selectedDimension: number;
  selectedMode: "flash" | "medium";
  selectedModel: "nomic-embed-text" | "mxbai-embed-large";
  ui: IApprovalUi;
  onApprovedReset: () => Promise<void>;
}

export type EmbeddingMismatchFlowStatus =
  | "no_mismatch"
  | "approved"
  | "rejected"
  | "cancelled";

export interface IEmbeddingMismatchFlowResult {
  status: EmbeddingMismatchFlowStatus;
}

export async function runEmbeddingMismatchFlow(
  input: IEmbeddingMismatchFlowInput
): Promise<IEmbeddingMismatchFlowResult> {
  if (!input.existingDimension || input.existingDimension === input.selectedDimension) {
    return { status: "no_mismatch" };
  }

  const approval = await input.ui.promptApproval({
    title: "Embedding change requires reset",
    bodyLines: [
      `Existing data uses embedding dimension ${input.existingDimension}.`,
      `Selected mode (${input.selectedMode}, ${input.selectedModel}) uses embedding dimension ${input.selectedDimension}.`,
      "Continuing will require resetting existing MemoryMesh data.",
      "Do you want to reset now?",
    ],
    confirmLabel: "Yes, reset now",
    rejectLabel: "No, keep current setup",
    allowCancel: true,
  });

  if (approval.status === "approved") {
    await input.onApprovedReset();
    return { status: "approved" };
  }
  if (approval.status === "rejected") {
    return { status: "rejected" };
  }

  return { status: "cancelled" };
}
