import * as dotenv from "dotenv";
import { execSync } from "node:child_process";
import { saveMemory, searchMemory } from "@memorymesh/runtime";

dotenv.config();

function ensureDockerServices(): void {
  const required = ["qdrant", "ollama", "mongodb"];
  const runningRaw = execSync("docker compose ps --services --status running", {
    encoding: "utf-8",
  });
  const running = runningRaw
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const missing = required.filter((service) => !running.includes(service));
  if (missing.length === 0) {
    console.log("Docker services already running:", required.join(", "));
    return;
  }

  console.log(
    `Starting missing Docker services: ${missing.join(", ")} (required: ${required.join(", ")})`
  );
  execSync("docker compose up -d", { stdio: "inherit" });
}

async function run(): Promise<void> {
  console.log("=== MemoryMesh Mongo Integration Test ===\n");

  ensureDockerServices();

  const longOutput = [
    "```ts",
    "export async function generateQuarterlyReport(data: number[]): Promise<{ total: number; average: number; outliers: number[] }> {",
    "  const total = data.reduce((sum, item) => sum + item, 0);",
    "  const average = data.length === 0 ? 0 : total / data.length;",
    "  const threshold = average * 1.5;",
    "  const outliers = data.filter((item) => item > threshold);",
    "  return { total, average, outliers };",
    "}",
    "",
    "export function formatReport(report: { total: number; average: number; outliers: number[] }): string {",
    "  return [",
    "    `Total=${report.total}`,",
    "    `Average=${report.average.toFixed(2)}`,",
    "    `Outliers=${report.outliers.join(',')}`",
    "  ].join('\\n');",
    "}",
    "```",
  ].join("\n");

  console.log("1) Saving output memory...");
  const saveResult = saveMemory({
    content: longOutput,
    project: "HumanTick",
    memory_type: "output",
    tags: ["report", "code", "typescript", "analytics"],
  });
  console.log(`   Saved with id: ${saveResult.id} (${saveResult.status})\n`);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2000);
  });

  console.log("2) Searching for related output...");
  const results = await searchMemory({
    query: "quarterly report generator function with outlier logic",
    project: "HumanTick",
    tags: ["report"],
    limit: 3,
  });
  console.log(`   Found ${results.length} result(s)\n`);

  if (results.length === 0) {
    throw new Error("No results returned from semantic search.");
  }

  const first = results[0];
  if (!first.full_content) {
    throw new Error(
      `full_content missing on top result (id=${first.id}). Mongo enrichment failed.`
    );
  }

  if (first.full_content !== longOutput) {
    throw new Error(
      `full_content mismatch for id=${first.id}. Expected exact raw content from MongoDB.`
    );
  }

  if (first.content.length > first.full_content.length) {
    throw new Error(
      `Payload content longer than full_content for id=${first.id}; expected full_content to be complete source of truth.`
    );
  }

  console.log("✅ PASS: MongoDB full_content retrieval works end-to-end.");
  console.log("   - full_content exists");
  console.log("   - full_content exactly matches original saved content");
  console.log("   - payload content length is compatible with full_content completeness");
  console.log("\n=== Mongo Integration Test Complete ===");
}

run().catch((error) => {
  console.error("❌ FAIL: Mongo integration test failed.");
  console.error(error);
  process.exit(1);
});
