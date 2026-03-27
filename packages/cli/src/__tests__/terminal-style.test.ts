import { style } from "../terminal-style";

describe("terminal-style renderTitle", () => {
  it("renders top-bottom frame only without vertical side borders", () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 220,
    });

    const output = style.renderTitle();

    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).toContain("└");
    expect(output).toContain("┘");
    expect(output).not.toContain("│");
    expect(output).toContain("\n\n   ");
  });
});
