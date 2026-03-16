import { runRustImporterEngine } from "../rust-engine";

jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

import { execFile } from "node:child_process";

const mockedExecFile = execFile as unknown as jest.Mock;

describe("rust-engine", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("parses successful rust engine output", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(
          null,
          JSON.stringify({
            scan_summary: {
              scanned_json_files: 1,
              supported_conversation_file: 1,
              unsupported_conversation_schema: 0,
              ignorable_json: 0,
              unknown_json: 0,
              invalid_json: 0,
            },
            files: [
              {
                path: "/tmp/a.json",
                category: "supported_conversation_file",
                reason: "array_with_mapping_and_current_node",
                conversations: [],
              },
            ],
          }),
          ""
        );
      }
    );

    const result = await runRustImporterEngine("/tmp/in");
    expect(result.scan_summary.supported_conversation_file).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it("throws on malformed rust json output", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, "not-json", "");
      }
    );

    await expect(runRustImporterEngine("/tmp/in")).rejects.toThrow(
      "Rust importer engine returned malformed JSON output"
    );
  });

  it("throws clear error when rust binary is missing", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void
      ) => {
        const err = new Error("spawn ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        callback(err, "", "");
      }
    );

    await expect(runRustImporterEngine("/tmp/in", "/missing/bin")).rejects.toThrow(
      "Rust importer engine binary not found"
    );
  });

  it("throws on invalid structured contract", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, JSON.stringify({ files: "invalid" }), "");
      }
    );

    await expect(runRustImporterEngine("/tmp/in")).rejects.toThrow(
      "Rust importer engine output does not match expected contract"
    );
  });
});
