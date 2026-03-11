import { MemoryType, SourceType } from "../types";

describe("@memorymesh/core types", () => {
  it("exposes expected union type literals", () => {
    const memoryType: MemoryType = "context";
    const sourceType: SourceType = "summary";

    expect(memoryType).toBe("context");
    expect(sourceType).toBe("summary");
  });
});
