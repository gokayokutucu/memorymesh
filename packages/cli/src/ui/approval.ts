export type ApprovalEvent =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "cancel" };

export type ApprovalResult =
  | { status: "approved" }
  | { status: "rejected" }
  | { status: "cancelled" };

export interface ApprovalOptions {
  title: string;
  bodyLines: string[];
  confirmLabel?: string;
  rejectLabel?: string;
  allowCancel?: boolean;
}

export interface IApprovalUi {
  promptApproval(options: ApprovalOptions): Promise<ApprovalResult>;
}

export function mapApprovalEventToResult(event: ApprovalEvent): ApprovalResult {
  if (event.type === "approve") {
    return { status: "approved" };
  }
  if (event.type === "reject") {
    return { status: "rejected" };
  }
  return { status: "cancelled" };
}
