const selectMock = jest.fn();
const isCancelMock = jest.fn((_arg: unknown) => false);

jest.mock("@clack/prompts", () => ({
  select: (arg: unknown) => selectMock(arg),
  isCancel: (arg: unknown) => isCancelMock(arg),
}));

import { ClackInstallerUi } from "../ui/installer-ui";

describe("installer ui", () => {
  beforeEach(() => {
    selectMock.mockReset();
    isCancelMock.mockReset();
    isCancelMock.mockReturnValue(false);
    selectMock.mockResolvedValue("nomic-embed-text");
  });

  it("preselects Flash when existing dimension is 768", async () => {
    const ui = new ClackInstallerUi();
    await ui.selectEmbeddingModel({ existingDimension: 768 });
    const call = selectMock.mock.calls[0]?.[0] as { initialValue?: string };
    expect(call.initialValue).toBe("nomic-embed-text");
  });

  it("preselects Medium when existing dimension is 1024", async () => {
    const ui = new ClackInstallerUi();
    await ui.selectEmbeddingModel({ existingDimension: 1024 });
    const call = selectMock.mock.calls[0]?.[0] as { initialValue?: string };
    expect(call.initialValue).toBe("mxbai-embed-large");
  });

  it("shows recommended and reset-warning labels when existing dimension is 768", async () => {
    const ui = new ClackInstallerUi();
    await ui.selectEmbeddingModel({ existingDimension: 768 });
    const call = selectMock.mock.calls[0]?.[0] as {
      options: Array<{ value: string; label: string }>;
    };

    const flash = call.options.find((option) => option.value === "nomic-embed-text");
    const medium = call.options.find((option) => option.value === "mxbai-embed-large");

    expect(flash?.label).toContain("Recommended (matches existing data)");
    expect(medium?.label).toContain("Will require reset");
  });

  it("shows recommended and reset-warning labels when existing dimension is 1024", async () => {
    const ui = new ClackInstallerUi();
    await ui.selectEmbeddingModel({ existingDimension: 1024 });
    const call = selectMock.mock.calls[0]?.[0] as {
      options: Array<{ value: string; label: string }>;
    };

    const flash = call.options.find((option) => option.value === "nomic-embed-text");
    const medium = call.options.find((option) => option.value === "mxbai-embed-large");

    expect(medium?.label).toContain("Recommended (matches existing data)");
    expect(flash?.label).toContain("Will require reset");
  });
});
