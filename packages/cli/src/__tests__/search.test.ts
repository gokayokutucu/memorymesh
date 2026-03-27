import {
  parseSearchArgs,
  renderSearchResultLines,
  runSearchCommand,
  stripDocumentSourcePreamble,
} from "../commands/search";

describe("search command", () => {
  const authority = {
    runtimeEnv: {
      EMBEDDING_MODEL: "mxbai-embed-large",
      MEMORYMESH_EMBEDDING_MODE: "medium",
      MEMORYMESH_EMBEDDING_DIMENSION: "1024",
    } as NodeJS.ProcessEnv,
  };

  afterEach(() => {
    delete process.env.EMBEDDING_MODEL;
    delete process.env.MEMORYMESH_EMBEDDING_MODE;
    delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
  });

  it("parses query args", () => {
    expect(parseSearchArgs(["--query", "hello"])).toEqual({
      query: "hello",
      limit: 5,
      project: undefined,
      filename: undefined,
      sourcePath: undefined,
      relativePath: undefined,
      sourceExtension: undefined,
      sourceType: undefined,
    });
  });

  it("parses metadata filter flags", () => {
    expect(
      parseSearchArgs([
        "--query",
        "hello",
        "--project",
        "MemoryMesh",
        "--filename",
        "notes.md",
        "--relative-path",
        "docs/notes.md",
        "--source-extension",
        ".md",
        "--source-type",
        "document",
      ])
    ).toEqual({
      query: "hello",
      limit: 5,
      project: "MemoryMesh",
      filename: "notes.md",
      sourcePath: undefined,
      relativePath: "docs/notes.md",
      sourceExtension: "md",
      sourceType: "document",
    });
  });

  it("returns error if query is missing", async () => {
    const result = await runSearchCommand([]);
    expect(result.ok).toBe(false);
  });

  it("invokes runtime search and normalizes results", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";

    const search = jest.fn().mockImplementation(async () => {
      expect(process.env.EMBEDDING_MODEL).toBe("mxbai-embed-large");
      expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("medium");
      expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("1024");
      return [{ preview: "A", content: "A content", source_type: "chatgpt" }];
    });
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);
    const result = await runSearchCommand(["--query", "hello"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(resolveEmbeddingAuthority).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      query: "hello",
      limit: 5,
      filename: undefined,
      source_path: undefined,
      relative_path: undefined,
      source_extension: undefined,
      source_type: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([{ snippet: "A", source: "chatgpt", sourceContext: undefined }]);
    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("passes combined metadata filters to runtime search", async () => {
    const search = jest.fn().mockResolvedValue([
      {
        content: "A content",
        source_type: "document",
        source_metadata: {
          filename: "notes.md",
          relative_path: "docs/notes.md",
          source_extension: "md",
        },
      },
    ]);
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);

    const result = await runSearchCommand(
      [
        "--query",
        "notes",
        "--project",
        "MemoryMesh",
        "--filename",
        "notes.md",
        "--relative-path",
        "docs/notes.md",
        "--source-extension",
        "md",
        "--source-type",
        "document",
      ],
      { search, resolveEmbeddingAuthority }
    );

    expect(search).toHaveBeenCalledWith({
      query: "notes",
      project: "MemoryMesh",
      limit: 5,
      filename: "notes.md",
      source_path: undefined,
      relative_path: "docs/notes.md",
      source_extension: "md",
      source_type: "document",
    });
    expect(result.ok).toBe(true);
    expect(result.results[0].sourceContext).toBe("[notes.md] docs/notes.md (.md)");
    expect(result.results[0].sourcePathLine).toBeUndefined();
  });

  it("renders chunk metadata in source context when available", async () => {
    const search = jest.fn().mockResolvedValue([
      {
        content: "Chunk content",
        source_type: "document",
        source_metadata: {
          filename: "manual.txt",
          relative_path: "docs/manual.txt",
          source_extension: "txt",
          chunk_index: 3,
          chunk_total: 9,
        },
      },
    ]);
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);

    const result = await runSearchCommand(["--query", "manual"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].sourceContext).toBe(
      "[manual.txt] docs/manual.txt (.txt, chunk 3/9)"
    );
    expect(result.results[0].sourcePathLine).toBeUndefined();
  });

  it("keeps plain rendering when source metadata is missing", async () => {
    const search = jest.fn().mockResolvedValue([
      {
        content: "Plain memory",
        source_type: "summary",
      },
    ]);
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);

    const result = await runSearchCommand(["--query", "plain"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { snippet: "Plain memory", source: "summary", sourceContext: undefined },
    ]);
  });

  it("truncates long relative path in source context compactly", async () => {
    const longPath =
      "very/long/path/with/many/segments/that/should/be/truncated/for/readability/document.txt";
    const search = jest.fn().mockResolvedValue([
      {
        content: "Long path memory",
        source_type: "document",
        source_metadata: {
          filename: "document.txt",
          relative_path: longPath,
          source_extension: "txt",
        },
      },
    ]);
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);

    const result = await runSearchCommand(["--query", "long"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].sourceContext).toContain("[document.txt]");
    expect(result.results[0].sourceContext).toContain("...");
    expect(result.results[0].sourceContext).toContain("(.txt)");
  });

  it("shows full untruncated source_path in detail line", async () => {
    const fullPath =
      "/tmp/samples/document-import/nested/more/deep-notes.txt";
    const search = jest.fn().mockResolvedValue([
      {
        content: "Deep note",
        source_type: "document",
        source_metadata: {
          filename: "deep-notes.txt",
          relative_path: "nested/more/deep-notes.txt",
          source_path: fullPath,
          source_extension: "txt",
          chunk_index: 9,
          chunk_total: 9,
        },
      },
    ]);
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);

    const result = await runSearchCommand(["--query", "deep"], {
      search,
      resolveEmbeddingAuthority,
    });

    expect(result.ok).toBe(true);
    expect(result.results[0].sourceContext).toBe(
      "[deep-notes.txt] nested/more/deep-notes.txt (.txt, chunk 9/9)"
    );
    expect(result.results[0].sourcePathLine).toBe(`Source path: ${fullPath}`);
    expect(result.results[0].sourcePathLine).not.toContain("...");
  });

  it("returns failure when runtime search throws", async () => {
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.MEMORYMESH_EMBEDDING_MODE = "flash";
    process.env.MEMORYMESH_EMBEDDING_DIMENSION = "768";
    const search = jest.fn().mockRejectedValue(new Error("runtime down"));
    const resolveEmbeddingAuthority = jest.fn().mockResolvedValue(authority);
    const result = await runSearchCommand(["--query", "hello"], {
      search,
      resolveEmbeddingAuthority,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Search failed");
    expect(process.env.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(process.env.MEMORYMESH_EMBEDDING_MODE).toBe("flash");
    expect(process.env.MEMORYMESH_EMBEDDING_DIMENSION).toBe("768");
  });

  it("strips document source preamble from snippet preview", () => {
    const content = [
      "[Document Source]",
      "filename: notes.txt",
      "source_path: /tmp/notes.txt",
      "relative_path: docs/notes.txt",
      "",
      "Alpha lantern memorymesh beacon",
    ].join("\n");

    expect(stripDocumentSourcePreamble(content)).toBe(
      "Alpha lantern memorymesh beacon"
    );
  });

  it("renders source metadata with dedicated full source path line", () => {
    const lines = renderSearchResultLines(
      {
        sourceContext: "[notes.txt] docs/notes.txt (.txt, chunk 3/9)",
        sourcePathLine: "Source path: /tmp/docs/notes.txt",
        snippet: [
          "[Document Source]",
          "filename: notes.txt",
          "",
          "Alpha lantern memorymesh beacon",
        ].join("\n"),
        source: "document",
      },
      1
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("1. [notes.txt] docs/notes.txt (.txt, chunk 3/9)");
    expect(lines[1]).toContain("Source path: /tmp/docs/notes.txt");
    expect(lines[2]).toContain("Alpha lantern memorymesh beacon");
    expect(lines[2]).not.toContain("[Document Source]");
  });

  it("keeps plain result rendering unchanged without source metadata", () => {
    const lines = renderSearchResultLines(
      {
        snippet: "Plain memory content",
        source: "summary",
      },
      2
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2.");
    expect(lines[0]).toContain("Plain memory content");
    expect(lines[0]).toContain("source=summary");
  });
});
