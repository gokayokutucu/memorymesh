import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import { saveMemory, searchMemory, getProjects } from "./memory";

dotenv.config();

const server = new McpServer({
  name: "memorymesh",
  version: "0.1.0",
});

// Tool: save_memory
server.tool(
  "save_memory",
  "Save an important memory, decision, or learning to persistent storage.",
  {
    content: z.string().describe("The information to remember"),
    project: z.string().describe("Project name, e.g. HumanTick"),
    memory_type: z
      .enum(["decision", "learning", "context", "preference"])
      .describe("Category of the memory"),
  },
  async ({ content, project, memory_type }) => {
    const id = await saveMemory({ content, project, memory_type });
    return {
      content: [{ type: "text", text: `Memory saved with id: ${id}` }],
    };
  }
);

// Tool: search_memory
server.tool(
  "search_memory",
  "Search for relevant memories. Call this when you need context that may have been discussed before.",
  {
    query: z.string().describe("What to search for"),
    project: z
      .string()
      .optional()
      .describe("Limit search to a specific project"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (default 5)"),
  },
  async ({ query, project, limit }) => {
    const results = await searchMemory({ query, project, limit });
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: "No relevant memories found." }],
      };
    }
    const formatted = results
      .map(
        (r, i) =>
          `[${i + 1}] (${r.project} / ${r.memory_type} / score: ${r.similarity_score.toFixed(3)})\n${r.content}`
      )
      .join("\n\n");
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Tool: list_projects
server.tool(
  "list_projects",
  "List all projects that have memories stored.",
  {},
  async () => {
    const projects = await getProjects();
    if (projects.length === 0) {
      return { content: [{ type: "text", text: "No projects found." }] };
    }
    const formatted = projects
      .map((p) => `- ${p.project}: ${p.memory_count} memories`)
      .join("\n");
    return { content: [{ type: "text", text: formatted }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MemoryMesh MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
