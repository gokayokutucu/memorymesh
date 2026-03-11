import * as dotenv from "dotenv";
dotenv.config();

import { saveMemory, searchMemory, getProjects } from "../src/memory";

async function run() {
  console.log("=== MemoryMesh Integration Test ===\n");

  // 1. Save a memory
  console.log("1. Saving memory...");
  const saveResult = saveMemory({
    content: "HumanTick uses a microservices architecture with an API Gateway pattern. Each service communicates via REST.",
    project: "HumanTick",
    memory_type: "context",
  });
  console.log(`   Saved with id: ${saveResult.id} (${saveResult.status})\n`);

  // 2. Save a second memory
  console.log("2. Saving second memory...");
  const saveResult2 = saveMemory({
    content: "Authentication in HumanTick is handled by a dedicated auth service using JWT tokens.",
    project: "HumanTick",
    memory_type: "decision",
  });
  console.log(`   Saved with id: ${saveResult2.id} (${saveResult2.status})\n`);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2000);
  });

  // 3. Search for related content
  console.log("3. Searching for 'authentication'...");
  const results = await searchMemory({
    query: "how does authentication work",
    project: "HumanTick",
    limit: 3,
  });
  console.log(`   Found ${results.length} result(s):`);
  results.forEach((r, i) => {
    console.log(`   [${i + 1}] score=${r.similarity_score.toFixed(3)} | ${r.content.slice(0, 80)}...`);
  });
  console.log();

  // 4. List projects
  console.log("4. Listing projects...");
  const projects = await getProjects();
  projects.forEach((p) => {
    console.log(`   - ${p.project}: ${p.memory_count} memories`);
  });
  console.log();

  // 5. Verify the saved memory appears in search results
  const authResult = results.find((r) => r.content.includes("JWT"));
  if (authResult) {
    console.log("✅ PASS: Saved memory was successfully retrieved by semantic search.");
  } else {
    console.log("❌ FAIL: Could not retrieve the saved memory. Check Qdrant and Ollama.");
    process.exit(1);
  }

  console.log("\n=== Integration Test Complete ===");
}

run().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
