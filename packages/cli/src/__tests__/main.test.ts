jest.mock("node:os", () => ({
  homedir: jest.fn(() => "/home/test"),
}));

jest.mock("../commands/import-gpt", () => ({
  runImportGptCommand: jest.fn(),
}));

jest.mock("../commands/import-documents", () => ({
  runImportDocumentsCommand: jest.fn(),
}));

jest.mock("../commands/doctor", () => ({
  runDoctorCommand: jest.fn(),
}));

jest.mock("../commands/lifecycle", () => ({
  runStartCommand: jest.fn(),
  runStopCommand: jest.fn(),
  runResetCommand: jest.fn(),
  runUninstallCommand: jest.fn(),
}));

jest.mock("../commands/mcp", () => ({
  runMcpCommand: jest.fn(),
}));

jest.mock("../commands/menu", () => ({
  runRuntimeMenu: jest.fn(),
}));

jest.mock("../commands/upgrade", () => ({
  runUpgradeCommand: jest.fn(),
}));

jest.mock("../system/runtime-home", () => ({
  resolveUserHomeDir: jest.fn(() => "/home/test"),
}));

jest.mock("../installer/first-run", () => ({
  isMemoryMeshInstalled: jest.fn(),
}));

jest.mock("../installer/setup-wizard", () => ({
  runSetupWizard: jest.fn(),
}));

import { runMain } from "../main";
import { runImportGptCommand } from "../commands/import-gpt";
import { runImportDocumentsCommand } from "../commands/import-documents";
import { runDoctorCommand } from "../commands/doctor";
import {
  runResetCommand,
  runStartCommand,
  runStopCommand,
  runUninstallCommand,
} from "../commands/lifecycle";
import { runMcpCommand } from "../commands/mcp";
import { runRuntimeMenu } from "../commands/menu";
import { runUpgradeCommand } from "../commands/upgrade";
import { resolveUserHomeDir } from "../system/runtime-home";
import { isMemoryMeshInstalled } from "../installer/first-run";
import { runSetupWizard } from "../installer/setup-wizard";

const mockedRunImportGptCommand = runImportGptCommand as jest.MockedFunction<
  typeof runImportGptCommand
>;
const mockedRunImportDocumentsCommand =
  runImportDocumentsCommand as jest.MockedFunction<typeof runImportDocumentsCommand>;
const mockedRunDoctorCommand = runDoctorCommand as jest.MockedFunction<
  typeof runDoctorCommand
>;
const mockedRunStartCommand = runStartCommand as jest.MockedFunction<
  typeof runStartCommand
>;
const mockedRunStopCommand = runStopCommand as jest.MockedFunction<
  typeof runStopCommand
>;
const mockedRunResetCommand = runResetCommand as jest.MockedFunction<
  typeof runResetCommand
>;
const mockedRunUninstallCommand = runUninstallCommand as jest.MockedFunction<
  typeof runUninstallCommand
>;
const mockedRunMcpCommand = runMcpCommand as jest.MockedFunction<typeof runMcpCommand>;
const mockedRunRuntimeMenu = runRuntimeMenu as jest.MockedFunction<
  typeof runRuntimeMenu
>;
const mockedRunUpgradeCommand = runUpgradeCommand as jest.MockedFunction<
  typeof runUpgradeCommand
>;
const mockedResolveUserHomeDir = resolveUserHomeDir as jest.MockedFunction<
  typeof resolveUserHomeDir
>;
const mockedIsMemoryMeshInstalled = isMemoryMeshInstalled as jest.MockedFunction<
  typeof isMemoryMeshInstalled
>;
const mockedRunSetupWizard = runSetupWizard as jest.MockedFunction<typeof runSetupWizard>;

describe("main CLI router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveUserHomeDir.mockReturnValue("/home/test");
    mockedRunRuntimeMenu.mockResolvedValue(0);
  });

  it("runs setup on first launch", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockedIsMemoryMeshInstalled.mockReturnValue(false);
    mockedRunSetupWizard.mockResolvedValue("completed");

    const code = await runMain([]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(mockedRunSetupWizard).toHaveBeenCalledTimes(1);
    expect(mockedRunRuntimeMenu).toHaveBeenCalledTimes(1);
  });

  it("stops before runtime menu when setup is cancelled", async () => {
    mockedIsMemoryMeshInstalled.mockReturnValue(false);
    mockedRunSetupWizard.mockResolvedValue("cancelled");

    const code = await runMain([]);

    expect(code).toBe(0);
    expect(mockedRunRuntimeMenu).not.toHaveBeenCalled();
  });

  it("renders ASCII title exactly once on interactive startup", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockedIsMemoryMeshInstalled.mockReturnValue(true);

    const code = await runMain([]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("███");
  });

  it("returns non-zero when home directory resolution fails", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockedResolveUserHomeDir.mockImplementation(() => {
      throw new Error("Unable to resolve user home directory");
    });

    const code = await runMain([]);

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("skips setup when already installed", async () => {
    mockedIsMemoryMeshInstalled.mockReturnValue(true);

    const code = await runMain([]);

    expect(code).toBe(0);
    expect(mockedRunSetupWizard).not.toHaveBeenCalled();
    expect(mockedRunRuntimeMenu).toHaveBeenCalledTimes(1);
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

  it("routes import:documents command to direct importer", async () => {
    mockedRunImportDocumentsCommand.mockResolvedValue(0);
    const code = await runMain(["import:documents", "--path", "/tmp/docs"]);
    expect(code).toBe(0);
    expect(mockedRunImportDocumentsCommand).toHaveBeenCalledWith([
      "--path",
      "/tmp/docs",
    ]);
  });

  it("routes doctor command", async () => {
    mockedRunDoctorCommand.mockResolvedValue(0);

    const code = await runMain(["doctor"]);

    expect(code).toBe(0);
    expect(mockedRunDoctorCommand).toHaveBeenCalledWith([]);
  });

  it("routes mcp command", async () => {
    mockedRunMcpCommand.mockResolvedValue(0);

    const code = await runMain(["mcp"]);

    expect(code).toBe(0);
    expect(mockedRunMcpCommand).toHaveBeenCalledWith([]);
  });

  it("routes lifecycle commands", async () => {
    mockedRunStartCommand.mockResolvedValue(0);
    mockedRunStopCommand.mockResolvedValue(0);
    mockedRunResetCommand.mockResolvedValue(0);
    mockedRunUninstallCommand.mockResolvedValue(0);

    expect(await runMain(["start"])).toBe(0);
    expect(await runMain(["stop"])).toBe(0);
    expect(await runMain(["reset"])).toBe(0);
    expect(await runMain(["uninstall"])).toBe(0);

    expect(mockedRunStartCommand).toHaveBeenCalledWith([]);
    expect(mockedRunStopCommand).toHaveBeenCalledWith([]);
    expect(mockedRunResetCommand).toHaveBeenCalledWith([]);
    expect(mockedRunUninstallCommand).toHaveBeenCalledWith([]);
  });

  it("routes upgrade command", async () => {
    mockedRunUpgradeCommand.mockResolvedValue(0);
    const code = await runMain(["upgrade"]);
    expect(code).toBe(0);
    expect(mockedRunUpgradeCommand).toHaveBeenCalledWith([]);
  });

  it("returns non-zero for unknown command", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMain(["unknown"]);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
