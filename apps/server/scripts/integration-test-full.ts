import * as dotenv from "dotenv";
import { execSync } from "node:child_process";
import { getProjects, saveMemory, searchMemory } from "../src/memory";

dotenv.config();

function fail(message: string): never {
  console.error(`❌ FAIL: ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`✅ PASS: ${message}`);
}

function ensureServicesRunning(): void {
  const requiredServices = ["qdrant", "ollama", "mongodb", "neo4j"];
  const runningOutput = execSync("docker compose ps --services --status running", {
    encoding: "utf-8",
  });
  const runningServices = runningOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const missing = requiredServices.filter(
    (service) => !runningServices.includes(service)
  );

  if (missing.length > 0) {
    fail(
      `Required Docker services are not running: ${missing.join(
        ", "
      )}. Run 'docker compose up -d' and retry.`
    );
  }
}

async function run(): Promise<void> {
  console.log("=== MemoryMesh Full-Stack Integration Test ===\n");

  ensureServicesRunning();
  pass("Docker services available (qdrant, ollama, mongodb, neo4j)");

  const contextContent =
    "MemoryMesh project uses a multi-store architecture with Qdrant for vectors, MongoDB for full outputs, and Neo4j for relationship graph.";
  const outputContent = [
    "```ts",
    "export interface IApiResponse<T> {",
    "  data: T;",
    "  success: boolean;",
    "  errors?: string[];",
    "}",
    "",
    "export async function executeWithRetry<T>(",
    "  task: () => Promise<T>,",
    "  maxRetries: number = 3,",
    "  delayMs: number = 200",
    "): Promise<IApiResponse<T>> {",
    "  let lastError: Error | null = null;",
    "  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {",
    "    try {",
    "      const data = await task();",
    "      return { data, success: true };",
    "    } catch (error) {",
    "      lastError = error as Error;",
    "      await new Promise((resolve) => setTimeout(resolve, delayMs));",
    "    }",
    "  }",
    "  return { data: null as unknown as T, success: false, errors: [lastError?.message ?? 'unknown error'] };",
    "}",
    "```",
  ].join("\n");
  const preferenceContent =
    "Prefer TypeScript over Python for all backend projects";

  console.log("1) Saving context memory...");
  saveMemory({
    content: contextContent,
    project: "MemoryMesh",
    memory_type: "context",
    tags: ["architecture", "stores"],
  });
  pass("Saved context memory (Qdrant + Neo4j route)");

  console.log("2) Saving output memory...");
  saveMemory({
    content: outputContent,
    project: "MemoryMesh",
    memory_type: "output",
    tags: ["typescript", "test"],
  });
  pass("Saved output memory (Qdrant + MongoDB + Neo4j route)");

  console.log("3) Saving preference memory...");
  saveMemory({
    content: preferenceContent,
    project: "MemoryMesh",
    memory_type: "preference",
    tags: ["preference", "typescript"],
  });
  pass("Saved preference memory (Qdrant-only route)");

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2500);
  });

  console.log("4) Searching output memory...");
  const outputResults = await searchMemory({
    query: "TypeScript executeWithRetry function with generic api response",
    project: "MemoryMesh",
    tags: ["typescript", "test"],
    limit: 5,
  });

  if (outputResults.length === 0) {
    fail("No output search results found.");
  }

  const outputMatch = outputResults.find(
    (item) => item.memory_type === "output" && item.content.includes("executeWithRetry")
  );
  if (!outputMatch) {
    fail("Could not find saved output memory in search results.");
  }
  if (!outputMatch.full_content) {
    fail("Output memory full_content is undefined; MongoDB enrichment failed.");
  }
  if (outputMatch.full_content !== outputContent) {
    fail("Output memory full_content does not match original content exactly.");
  }
  if (!outputMatch.tags || !outputMatch.tags.includes("typescript")) {
    fail("Output memory tags missing expected 'typescript' tag.");
  }
  pass("Output memory search includes exact full_content and expected tags");

  console.log("5) Searching preference memory...");
  const preferenceResults = await searchMemory({
    query: "backend language preference",
    project: "MemoryMesh",
    tags: ["preference"],
    limit: 5,
  });

  if (preferenceResults.length === 0) {
    fail("No preference search results found.");
  }

  const preferenceMatch = preferenceResults.find(
    (item) =>
      item.memory_type === "preference" &&
      item.content.includes("Prefer TypeScript over Python")
  );
  if (!preferenceMatch) {
    fail("Could not find saved preference memory in search results.");
  }
  if (preferenceMatch.full_content !== undefined) {
    fail("Preference memory full_content should be undefined (not persisted in MongoDB).");
  }
  pass("Preference memory found and correctly has no full_content");

  console.log("6) Listing projects...");
  const projects = await getProjects();
  const memoryMeshProject = projects.find((p) => p.project === "MemoryMesh");
  if (!memoryMeshProject) {
    fail("Project 'MemoryMesh' not found in list_projects output.");
  }
  if (memoryMeshProject.memory_count < 3) {
    fail(
      `Expected MemoryMesh memory_count >= 3, got ${memoryMeshProject.memory_count}.`
    );
  }
  pass("Project list includes MemoryMesh with memory_count >= 3");

  console.log("\n=== Full-Stack Integration Test Complete ===");
}

run().catch((error) => {
  console.error("❌ FAIL: Full-stack integration test crashed.");
  console.error(error);
  process.exit(1);
});
