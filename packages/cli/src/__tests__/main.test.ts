jest.mock("../commands/import-gpt", () => ({
  runImportGptCommand: jest.fn(),
}));

jest.mock("../interactive", () => ({
  runInteractiveCli: jest.fn(),
}));

import { runMain } from "../main";
import { runImportGptCommand } from "../commands/import-gpt";
import { runInteractiveCli } from "../interactive";

const mockedRunImportGptCommand = runImportGptCommand as jest.MockedFunction<
  typeof runImportGptCommand
>;
const mockedRunInteractiveCli = runInteractiveCli as jest.MockedFunction<
  typeof runInteractiveCli
>;

describe("main CLI router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes to interactive mode when no args are provided", async () => {
    mockedRunInteractiveCli.mockResolvedValue(0);
    const code = await runMain([]);
    expect(code).toBe(0);
    expect(mockedRunInteractiveCli).toHaveBeenCalledTimes(1);
    expect(mockedRunImportGptCommand).not.toHaveBeenCalled();
  });

  it("routes import:gpt command to direct importer", async () => {
    mockedRunImportGptCommand.mockResolvedValue(0);
    const code = await runMain(["import:gpt", "--path", "/tmp/export"]);
    expect(code).toBe(0);
    expect(mockedRunImportGptCommand).toHaveBeenCalledWith([
      "--path",
      "/tmp/export",
    ]);
  });

  it("returns non-zero for unknown command", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMain(["unknown"]);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
