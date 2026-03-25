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
});
