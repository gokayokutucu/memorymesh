import { ISearchMemoryInput } from "@memorymesh/core";
import { searchMemory } from "@memorymesh/runtime";
import { nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { resolveAuthoritativeEmbeddingConfig } from "../installer/embedding-authority";
import { style } from "../terminal-style";

export interface IParsedSearchArgs {
  query: string;
  limit: number;
  project?: string;
  filename?: string;
  sourcePath?: string;
  relativePath?: string;
  sourceExtension?: string;
  sourceType?: string;
}

export interface IRuntimeSearchResult {
  snippet: string;
  source?: string;
  sourceContext?: string;
  sourcePathLine?: string;
}

export interface IRunSearchResult {
  ok: boolean;
  message: string;
  results: IRuntimeSearchResult[];
}

export interface ISearchRenderOptions {
  snippetMaxChars?: number;
}

export interface ISearchDeps {
  search: (input: ISearchMemoryInput) => Promise<
    Array<{
      preview?: string;
      content: string;
      source_type?: string;
      ref_id?: string;
      source_metadata?: {
        filename?: string;
        source_path?: string;
        relative_path?: string;
        source_extension?: string;
        chunk_index?: number;
        chunk_total?: number;
      };
    }>
  >;
  resolveEmbeddingAuthority: () => Promise<{
    runtimeEnv: NodeJS.ProcessEnv;
  }>;
}

function createDefaultDeps(): ISearchDeps {
  const homeDir = resolveUserHomeDir(process.platform, process.env);
  return {
    search: searchMemory,
    resolveEmbeddingAuthority: async () =>
      resolveAuthoritativeEmbeddingConfig(homeDir, nodeFileSystem),
  };
}

async function withRuntimeEnv<T>(
  runtimeEnv: NodeJS.ProcessEnv,
  action: () => Promise<T>
): Promise<T> {
  const previous = {
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    MEMORYMESH_EMBEDDING_MODE: process.env.MEMORYMESH_EMBEDDING_MODE,
    MEMORYMESH_EMBEDDING_DIMENSION: process.env.MEMORYMESH_EMBEDDING_DIMENSION,
  };

  process.env.EMBEDDING_MODEL = runtimeEnv.EMBEDDING_MODEL;
  process.env.MEMORYMESH_EMBEDDING_MODE = runtimeEnv.MEMORYMESH_EMBEDDING_MODE;
  process.env.MEMORYMESH_EMBEDDING_DIMENSION = runtimeEnv.MEMORYMESH_EMBEDDING_DIMENSION;
  try {
    return await action();
  } finally {
    if (previous.EMBEDDING_MODEL === undefined) {
      delete process.env.EMBEDDING_MODEL;
    } else {
      process.env.EMBEDDING_MODEL = previous.EMBEDDING_MODEL;
    }
    if (previous.MEMORYMESH_EMBEDDING_MODE === undefined) {
      delete process.env.MEMORYMESH_EMBEDDING_MODE;
    } else {
      process.env.MEMORYMESH_EMBEDDING_MODE = previous.MEMORYMESH_EMBEDDING_MODE;
    }
    if (previous.MEMORYMESH_EMBEDDING_DIMENSION === undefined) {
      delete process.env.MEMORYMESH_EMBEDDING_DIMENSION;
    } else {
      process.env.MEMORYMESH_EMBEDDING_DIMENSION = previous.MEMORYMESH_EMBEDDING_DIMENSION;
    }
  }
}

export function parseSearchArgs(argv: string[]): IParsedSearchArgs | null {
  let query = "";
  let limit = 5;
  let project: string | undefined;
  let filename: string | undefined;
  let sourcePath: string | undefined;
  let relativePath: string | undefined;
  let sourceExtension: string | undefined;
  let sourceType: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--query") {
      query = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (token === "--limit") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
      i += 1;
      continue;
    }

    if (token === "--project") {
      project = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--filename") {
      filename = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--source-path") {
      sourcePath = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--relative-path") {
      relativePath = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--source-extension") {
      sourceExtension = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === "--source-type") {
      sourceType = argv[i + 1];
      i += 1;
    }
  }

  if (!query.trim()) {
    return null;
  }

  return {
    query: query.trim(),
    limit,
    project: project?.trim() || undefined,
    filename: filename?.trim() || undefined,
    sourcePath: sourcePath?.trim() || undefined,
    relativePath: relativePath?.trim() || undefined,
    sourceExtension: normalizeSourceExtension(sourceExtension),
    sourceType: sourceType?.trim() || undefined,
  };
}

export async function runSearchCommand(
  argv: string[],
  deps: Partial<ISearchDeps> = {}
): Promise<IRunSearchResult> {
  const parsed = parseSearchArgs(argv);
  if (!parsed) {
    return {
      ok: false,
      message: "Search query is required. Use --query <text>.",
      results: [],
    };
  }

  const resolved = { ...createDefaultDeps(), ...deps };

  try {
    const authority = await resolved.resolveEmbeddingAuthority();
    const raw = await withRuntimeEnv(authority.runtimeEnv, async () =>
      resolved.search({
        query: parsed.query,
        project: parsed.project,
        limit: parsed.limit,
        filename: parsed.filename,
        source_path: parsed.sourcePath,
        relative_path: parsed.relativePath,
        source_extension: parsed.sourceExtension,
        source_type: parsed.sourceType,
      })
    );

    const results = raw.slice(0, parsed.limit).map((item) => {
      const sourceInfo = buildSourceContext(item.source_metadata);
      return {
        snippet: item.preview ?? item.content,
        source: item.source_type ?? item.ref_id,
        ...(sourceInfo.sourceContext
          ? { sourceContext: sourceInfo.sourceContext }
          : {}),
        ...(sourceInfo.sourcePathLine
          ? { sourcePathLine: sourceInfo.sourcePathLine }
          : {}),
      };
    });

    return {
      ok: true,
      message: "Search completed.",
      results,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Search failed. Ensure MemoryMesh runtime services are running. ${String(error)}`,
      results: [],
    };
  }
}

export function renderSearchResultLines(
  row: IRuntimeSearchResult,
  index: number,
  options: ISearchRenderOptions = {}
): string[] {
  const snippetMaxChars = options.snippetMaxChars ?? 120;
  const snippet = truncateText(
    stripDocumentSourcePreamble(row.snippet),
    snippetMaxChars
  );
  const sourceSuffix = row.source ? style.muted(` | source=${row.source}`) : "";

  if (!row.sourceContext) {
    return [`${style.heading(`${index}.`)} ${snippet}${sourceSuffix}`];
  }

  const lines: string[] = [
    `${style.heading(`${index}. ${row.sourceContext}`)}${sourceSuffix}`,
  ];
  if (row.sourcePathLine) {
    lines.push(`   ${style.muted(row.sourcePathLine)}`);
  }
  lines.push(`   ${snippet}`);
  return lines;
}

export function stripDocumentSourcePreamble(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("[Document Source]")) {
    return content;
  }

  const lines = normalized.split("\n");
  let cursor = 1;
  while (cursor < lines.length && /^[-_a-zA-Z0-9]+:\s*/.test(lines[cursor].trim())) {
    cursor += 1;
  }
  while (cursor < lines.length && lines[cursor].trim() === "") {
    cursor += 1;
  }
  const stripped = lines.slice(cursor).join("\n").trim();
  return stripped || content;
}

function normalizeSourceExtension(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function buildSourceContext(
  metadata: {
    filename?: string;
    source_path?: string;
    relative_path?: string;
    source_extension?: string;
    chunk_index?: number;
    chunk_total?: number;
  } | undefined
): { sourceContext?: string; sourcePathLine?: string } {
  if (!metadata) {
    return {};
  }
  const filename = metadata.filename?.trim();
  const relativePath = metadata.relative_path?.trim();
  const sourcePath = metadata.source_path?.trim();
  const displayPath = relativePath || sourcePath;

  const leadParts: string[] = [];
  if (filename) {
    leadParts.push(`[${filename}]`);
  }
  if (displayPath && displayPath !== filename) {
    leadParts.push(truncateMiddle(displayPath, 64));
  }

  const detailParts: string[] = [];
  if (metadata.source_extension?.trim()) {
    detailParts.push(`.${metadata.source_extension.trim()}`);
  }
  if (
    typeof metadata.chunk_index === "number" &&
    Number.isFinite(metadata.chunk_index) &&
    typeof metadata.chunk_total === "number" &&
    Number.isFinite(metadata.chunk_total)
  ) {
    detailParts.push(`chunk ${metadata.chunk_index}/${metadata.chunk_total}`);
  }

  let sourceContext: string | undefined;
  if (leadParts.length === 0 && detailParts.length === 0) {
    sourceContext = undefined;
  } else if (detailParts.length === 0) {
    sourceContext = leadParts.join(" ");
  } else if (leadParts.length === 0) {
    sourceContext = `(${detailParts.join(", ")})`;
  } else {
    sourceContext = `${leadParts.join(" ")} (${detailParts.join(", ")})`;
  }

  return {
    sourceContext,
    sourcePathLine: sourcePath ? `Source path: ${sourcePath}` : undefined,
  };
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength < 10) {
    return value.slice(0, maxLength);
  }
  const keep = maxLength - 3;
  const front = Math.ceil(keep / 2);
  const back = Math.floor(keep / 2);
  return `${value.slice(0, front)}...${value.slice(-back)}`;
}

function truncateText(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars - 3)}...`;
}
