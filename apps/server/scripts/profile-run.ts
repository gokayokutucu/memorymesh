import * as dotenv from "dotenv";
dotenv.config();

import {
  embed,
  ensureCollection,
  orchestrateSave,
  orchestrateSearch,
  Profiler,
  ITimingEntry,
  ISaveMemoryInput,
  ISearchMemoryInput,
} from "@memorymesh/runtime";

interface IProfileRow {
  operation: string;
  entries: ITimingEntry[];
}

function sumByLabel(entries: ITimingEntry[], labels: string[]): number {
  return entries
    .filter((entry) => labels.includes(entry.label))
    .reduce((acc, entry) => acc + entry.duration_ms, 0);
}

function total(entries: ITimingEntry[]): number {
  return entries.reduce((acc, entry) => acc + entry.duration_ms, 0);
}

function formatMs(value: number): string {
  return `${value}ms`;
}

function toColumns(entries: ITimingEntry[]): {
  embed: number;
  qdrant: number;
  mongo: number;
  neo4j: number;
  sort: number;
  total: number;
} {
  return {
    embed: sumByLabel(entries, ["embed"]),
    qdrant: sumByLabel(entries, ["qdrant_save", "qdrant_search"]),
    mongo: sumByLabel(entries, ["mongo_save", "mongo_fetch"]),
    neo4j: sumByLabel(entries, ["neo4j_save", "neo4j_query"]),
    sort: sumByLabel(entries, ["recency_sort"]),
    total: total(entries),
  };
}

function printTable(rows: IProfileRow[]): void {
  console.log("Operation         | embed  | qdrant | mongo  | neo4j  | sort   | total");
  console.log("------------------|--------|--------|--------|--------|--------|-------");
  for (const row of rows) {
    const c = toColumns(row.entries);
    const op = row.operation.padEnd(17, " ");
    const line = `${op} | ${formatMs(c.embed).padStart(6, " ")} | ${formatMs(c.qdrant).padStart(6, " ")} | ${formatMs(c.mongo).padStart(6, " ")} | ${formatMs(c.neo4j).padStart(6, " ")} | ${formatMs(c.sort).padStart(6, " ")} | ${formatMs(c.total).padStart(6, " ")}`;
    console.log(line);
  }
}

function slowestStep(entries: ITimingEntry[]): ITimingEntry | null {
  if (entries.length === 0) {
    return null;
  }
  return [...entries].sort((a, b) => b.duration_ms - a.duration_ms)[0];
}

async function profileSave(
  operation: string,
  input: ISaveMemoryInput
): Promise<IProfileRow> {
  const profiler = new Profiler();
  const vector = await profiler.time("embed", async () => embed(input.content));
  await orchestrateSave(input, vector, profiler);
  return { operation, entries: profiler.report() };
}

async function profileSearch(
  operation: string,
  input: ISearchMemoryInput
): Promise<IProfileRow> {
  const profiler = new Profiler();
  if (input.ref_id) {
    await orchestrateSearch([], input, profiler);
  } else {
    const vector = await profiler.time("embed", async () => embed(input.query));
    await orchestrateSearch(vector, input, profiler);
  }
  return { operation, entries: profiler.report() };
}

async function run(): Promise<void> {
  console.log("=== MemoryMesh Profile Run ===\n");
  await ensureCollection();

  const saveRows: IProfileRow[] = [];
  saveRows.push(await profileSave("save/decision", {
    content: "MM profile decision: use staged rollout for auth migration.",
    project: "MemoryMesh",
    memory_type: "decision",
    tags: ["auth", "rollout"],
    ref_id: "PROFILE-001",
    title: "Auth rollout decision",
    source_type: "summary",
  }));
  saveRows.push(await profileSave("save/output", {
    content:
      "function deployFeature(flag: string) {\n  const enabled = process.env[flag] === 'true';\n  if (!enabled) return 'skip';\n  return 'deploy';\n}\n\nexport async function executeDeployment(): Promise<string> {\n  const state = deployFeature('ENABLE_DEPLOYMENT');\n  return `deployment=${state}`;\n}\n",
    project: "MemoryMesh",
    memory_type: "output",
    tags: ["typescript", "deployment"],
    ref_id: "PROFILE-002",
    title: "Deployment function output",
    source_type: "code_block",
  }));
  saveRows.push(await profileSave("save/preference", {
    content: "Prefer TypeScript strict mode and isolated tests.",
    project: "MemoryMesh",
    memory_type: "preference",
    tags: ["typescript", "testing"],
    ref_id: "PROFILE-003",
    title: "Engineering preference",
    source_type: "summary",
  }));
  saveRows.push(await profileSave("save/context", {
    content: "MemoryMesh pipeline uses Qdrant+MongoDB+Neo4j with orchestrated save/search.",
    project: "MemoryMesh",
    memory_type: "context",
    tags: ["architecture", "pipeline"],
    ref_id: "PROFILE-004",
    title: "Pipeline context",
    source_type: "summary",
  }));
  saveRows.push(await profileSave("save/learning", {
    content: "Observed that combined graph enrichment improves contextual recall for sparse queries.",
    project: "MemoryMesh",
    memory_type: "learning",
    tags: ["graph", "recall"],
    ref_id: "PROFILE-005",
    title: "Graph recall learning",
    source_type: "summary",
  }));

  const searchRows: IProfileRow[] = [];
  searchRows.push(await profileSearch("search/text", {
    query: "auth rollout decision",
    project: "MemoryMesh",
    limit: 5,
  }));
  searchRows.push(await profileSearch("search/tag", {
    query: "deployment",
    project: "MemoryMesh",
    tags: ["typescript"],
    limit: 5,
  }));
  searchRows.push(await profileSearch("search/temporal", {
    query: "pipeline history",
    project: "MemoryMesh",
    after: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    sort_by: "recency",
    limit: 5,
  }));
  searchRows.push(await profileSearch("search/ref", {
    query: "PROFILE-002",
    ref_id: "PROFILE-002",
    project: "MemoryMesh",
    limit: 3,
  }));
  searchRows.push(await profileSearch("search/oldest", {
    query: "MemoryMesh",
    project: "MemoryMesh",
    sort_by: "oldest",
    limit: 5,
  }));

  const rows = [...saveRows, ...searchRows];
  printTable(rows);

  console.log("\nSlowest step by operation:");
  for (const row of rows) {
    const slowest = slowestStep(row.entries);
    if (!slowest) {
      console.log(`- ${row.operation}: n/a`);
      continue;
    }
    console.log(`- ${row.operation}: ${slowest.label} (${slowest.duration_ms}ms)`);
  }

}

run().catch((error) => {
  console.error("Profile run failed:", error);
  process.exit(1);
});
