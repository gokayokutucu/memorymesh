import { ISearchMemoryInput } from "@memorymesh/core";
import { searchMemory } from "@memorymesh/runtime";
import { nodeFileSystem } from "../system/filesystem";
import { resolveUserHomeDir } from "../system/runtime-home";
import { resolveAuthoritativeEmbeddingConfig } from "../installer/embedding-authority";

export interface IParsedSearchArgs {
  query: string;
  limit: number;
  project?: string;
}

export interface IRuntimeSearchResult {
  snippet: string;
  source?: string;
}

export interface IRunSearchResult {
  ok: boolean;
  message: string;
  results: IRuntimeSearchResult[];
}

export interface ISearchDeps {
  search: (input: ISearchMemoryInput) => Promise<
    Array<{
      preview?: string;
      content: string;
      source_type?: string;
      ref_id?: string;
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
    }
  }

  if (!query.trim()) {
    return null;
  }

  return {
    query: query.trim(),
    limit,
    project: project?.trim() || undefined,
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
      })
    );

    const results = raw.slice(0, parsed.limit).map((item) => ({
      snippet: item.preview ?? item.content,
      source: item.source_type ?? item.ref_id,
    }));

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
