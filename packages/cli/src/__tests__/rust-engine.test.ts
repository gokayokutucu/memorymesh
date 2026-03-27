import {
  runRustDocumentImporterEngine,
  runRustImporterEngine,
} from "../rust-engine";

jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

import { execFile } from "node:child_process";

const mockedExecFile = execFile as unknown as jest.Mock;

describe("rust-engine", () => {
  const originalRustEngineBin = process.env.MEMORYMESH_RUST_ENGINE_BIN;

  beforeEach(() => {
    mockedExecFile.mockReset();
    if (originalRustEngineBin === undefined) {
      delete process.env.MEMORYMESH_RUST_ENGINE_BIN;
    } else {
      process.env.MEMORYMESH_RUST_ENGINE_BIN = originalRustEngineBin;
    }
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

    await expect(runRustImporterEngine("/tmp/in")).rejects.toThrow(
      "Rust importer engine binary not found"
    );
  });

  it("rejects non-absolute MEMORYMESH_RUST_ENGINE_BIN override", async () => {
    process.env.MEMORYMESH_RUST_ENGINE_BIN = "relative/bin/importer-engine";

    await expect(runRustImporterEngine("/tmp/in")).rejects.toThrow(
      "Rust importer engine override must be an absolute path (MEMORYMESH_RUST_ENGINE_BIN)."
    );
  });

  it("rejects missing MEMORYMESH_RUST_ENGINE_BIN override path", async () => {
    process.env.MEMORYMESH_RUST_ENGINE_BIN = "/tmp/does-not-exist-importer-engine";

    await expect(runRustImporterEngine("/tmp/in")).rejects.toThrow(
      "Rust importer engine override path does not exist (MEMORYMESH_RUST_ENGINE_BIN)"
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

  it("passes explicit runtime env to rust engine process", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        _args: string[],
        options: { env?: NodeJS.ProcessEnv },
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        expect(options.env?.EMBEDDING_MODEL).toBe("mxbai-embed-large");
        expect(options.env?.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
        expect(options.env?.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
        callback(
          null,
          JSON.stringify({
            scan_summary: {
              scanned_json_files: 0,
              supported_conversation_file: 0,
              unsupported_conversation_schema: 0,
              ignorable_json: 0,
              unknown_json: 0,
              invalid_json: 0,
            },
            files: [],
          }),
          ""
        );
      }
    );

    await expect(
      runRustImporterEngine("/tmp/in", undefined, {
        EMBEDDING_MODEL: "mxbai-embed-large",
        MEMORYMESH_EMBEDDING_MODE: "medium",
        MEMORYMESH_EMBEDDING_DIMENSION: "1024",
      })
    ).resolves.toMatchObject({
      scan_summary: { scanned_json_files: 0 },
      files: [],
    });
  });

  it("parses successful rust document engine output", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        expect(args[0]).toBe("documents");
        callback(
          null,
          JSON.stringify({
            scan_summary: {
              discovered_files: 1,
              supported_files: 1,
              skipped_files: 0,
            },
            files: [
              {
                path: "/tmp/a.txt",
                relative_path: "a.txt",
                extension: ".txt",
                size_bytes: 12,
                status: "supported",
                reason: "parsed",
                chunks: [
                  { content: "hello", chunk_index: 0, chunk_total: 1 },
                ],
              },
            ],
          }),
          ""
        );
      }
    );

    const result = await runRustDocumentImporterEngine("/tmp/in", {
      max_file_size_mb: 5,
      max_chars_per_file: 100000,
      max_chunks_per_file: 200,
      chunk_size: 1200,
      chunk_overlap: 150,
    });
    expect(result.scan_summary.supported_files).toBe(1);
    expect(result.files[0].chunks).toHaveLength(1);
  });

  it("throws on malformed rust document json output", async () => {
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

    await expect(
      runRustDocumentImporterEngine("/tmp/in", {
        max_file_size_mb: 5,
        max_chars_per_file: 100000,
        max_chunks_per_file: 200,
        chunk_size: 1200,
        chunk_overlap: 150,
      })
    ).rejects.toThrow("Rust document importer engine returned malformed JSON output");
  });

  it("fails with manual rebuild instruction on legacy document output contract", async () => {
    mockedExecFile.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (args[0] === "documents") {
          callback(
            null,
            JSON.stringify({
              scan_summary: {
                scanned_json_files: 0,
                supported_conversation_file: 0,
                unsupported_conversation_schema: 0,
                ignorable_json: 0,
                unknown_json: 0,
                invalid_json: 0,
              },
              files: [],
            }),
            ""
          );
          return;
        }

        callback(new Error("unexpected command path"), "", "");
      }
    );

    await expect(
      runRustDocumentImporterEngine("/tmp/in", {
        max_file_size_mb: 5,
        max_chars_per_file: 100000,
        max_chunks_per_file: 200,
        chunk_size: 1200,
        chunk_overlap: 150,
      })
    ).rejects.toThrow(
      "Rust document importer binary is outdated for document mode. Rebuild manually with: cargo build --manifest-path native/importer-engine/Cargo.toml"
    );
    expect(mockedExecFile.mock.calls.some((call) => call[0] === "cargo")).toBe(false);
  });
});
