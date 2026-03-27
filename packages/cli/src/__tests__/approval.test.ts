import {
  ApprovalResult,
  mapApprovalEventToResult,
} from "../ui/approval";

describe("approval result mapping", () => {
  it("maps approve event to approved result", () => {
    const result = mapApprovalEventToResult({ type: "approve" });
    expect(result).toEqual<ApprovalResult>({ status: "approved" });
  });

  it("maps reject event to rejected result", () => {
    const result = mapApprovalEventToResult({ type: "reject" });
    expect(result).toEqual<ApprovalResult>({ status: "rejected" });
  });

  it("maps cancel event to cancelled result", () => {
    const result = mapApprovalEventToResult({ type: "cancel" });
    expect(result).toEqual<ApprovalResult>({ status: "cancelled" });
  });
});
