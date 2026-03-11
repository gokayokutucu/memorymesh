import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as net from "node:net";
import type { Request, Response } from "express";
import { z } from "zod";
import * as dotenv from "dotenv";
import { saveMemory, searchMemory, getProjects } from "./memory";

dotenv.config();

const TRANSPORT = process.env.TRANSPORT ?? "stdio";
const BASE_HTTP_PORT = Number(process.env.HTTP_PORT ?? "3456");
const MAX_PORT_ATTEMPTS = 10;
const MEMORY_TYPE_DESCRIPTION =
  "decision=architectural/technical choice made, " +
  "learning=bug found or lesson learned, " +
  "context=project background/setup/config, " +
  "preference=user workflow/style/tool preference, " +
  "output=code block/email/document/plan produced";

/**
 * Her çağrıda araçlarla donatılmış yeni bir McpServer döner.
 * HTTP modunda her request kendi server+transport çiftini alır;
 * "Already connected" hatasını önler.
 */
function createServer(): McpServer {
  const server = new McpServer({ name: "memorymesh", version: "0.1.0" });

  server.tool(
    "save_memory",
    "Save important context to persistent memory. ROUTING RULES: if the response contains a code block, email, document or plan -> use memory_type='output' and set content to the FULL text (stored in MongoDB for exact retrieval). For all other types -> set content to a concise [INPUT]/[OUTPUT] summary (stored in Qdrant for semantic search). Always infer project and tags from conversation.",
    {
      content: z.string().describe(
        "For memory_type='output': include the FULL content exactly as produced,\n" +
        "using these fencing rules:\n" +
        "- If the content is a markdown document -> wrap with ```markdown ... ```\n" +
        "- For all other content (code in any language: TypeScript, C#, Cypher, SQL,\n" +
        "  bash, etc.) -> wrap with ~~~<lang> ... ~~~ (tilde fences, NOT backticks)\n" +
        "This ensures backtick fences are never nested inside each other."
      ),
      project: z
        .string()
        .optional()
        .describe("Project name. Infer from context when possible; use \"general\" if unclear."),
      memory_type: z
        .enum(["decision", "learning", "context", "preference", "output"])
        .describe(MEMORY_TYPE_DESCRIPTION),
      tags: z.array(z.string()).optional().describe(
        "Short topic keywords inferred from conversation context, e.g. ['auth', 'jwt', 'docker']. Infer these yourself — do not ask the user."
      ),
      title: z
        .string()
        .optional()
        .describe(
          "Human-readable title. Use task name if present e.g. 'Task: Creating API', or a prompt ID like 'MM-012'."
        ),
      ref_id: z
        .string()
        .optional()
        .describe(
          "Explicit reference ID for exact lookup e.g. 'MM-012', 'TASK-001'. Set whenever a prompt ID or task ID is visible in the conversation."
        ),
      source_type: z
        .enum(["code_block", "email", "document", "plan", "summary"])
        .optional()
        .describe(
          "code_block=any code, email=email draft, document=doc/report, plan=step-by-step plan, summary=general summary."
        ),
    },
    async ({ content, project, memory_type, tags, title, ref_id, source_type }) => {
      const result = saveMemory({
        content,
        project: project ?? "general",
        memory_type,
        tags,
        title,
        ref_id,
        source_type,
      });
      return {
        content: [
          { type: "text", text: `Saved with id: ${result.id} (indexing in background)` },
        ],
      };
    }
  );

  server.tool(
    "search_memory",
    "Search for relevant memories. Call this when you need context that may have been discussed before.",
    {
      query: z.string().describe("What to search for"),
      project: z.string().optional().describe("Limit search to a specific project"),
      limit: z.number().optional().describe("Max results to return (default 5)"),
      tags: z.array(z.string()).optional().describe("Filter results by tags"),
      ref_id: z
        .string()
        .optional()
        .describe("Exact ID lookup, e.g. 'MM-012'"),
      title: z
        .string()
        .optional()
        .describe("Filter by exact title"),
      source_type: z
        .string()
        .optional()
        .describe("Filter by source type"),
      sort_by: z
        .enum(["relevance", "recency", "oldest"])
        .optional()
        .describe(
          "relevance=default vector score, recency=newest first, oldest=oldest first. Use 'oldest' for 'first time we discussed X', 'recency' for 'latest'."
        ),
      before: z
        .string()
        .optional()
        .describe(
          "ISO datetime — return memories created before this time e.g. '2026-03-08T00:00:00Z'"
        ),
      after: z
        .string()
        .optional()
        .describe(
          "ISO datetime — return memories created after this time e.g. '2026-03-07T00:00:00Z'"
        ),
    },
    async ({ query, project, limit, tags, ref_id, title, source_type, sort_by, before, after }) => {
      const results = await searchMemory({
        query,
        project,
        limit,
        tags,
        ref_id,
        title,
        source_type,
        sort_by,
        before,
        after,
      });
      if (results.length === 0) {
        return { content: [{ type: "text", text: "No relevant memories found." }] };
      }
      const formatted = results
        .map((r, i) => {
          const tagsPart =
            r.tags && r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
          const outputContent = r.full_content ?? r.content;
          const metadataParts = [
            r.ref_id ? `ref: ${r.ref_id}` : "",
            r.title ?? "",
          ].filter((item) => item.length > 0);
          const metadataPart =
            metadataParts.length > 0 ? ` | ${metadataParts.join(" | ")}` : "";
          return `[${i + 1}] (${r.project} / ${r.memory_type} / score: ${r.similarity_score.toFixed(3)})${tagsPart}${metadataPart}\n${outputContent}`;
        })
        .join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    }
  );

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

  return server;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probeServer = net.createServer();
    probeServer.once("error", () => resolve(false));
    probeServer.once("listening", () => { probeServer.close(); resolve(true); });
    probeServer.listen(port);
  });
}

async function resolveHttpPort(basePort: number, maxAttempts: number): Promise<number> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const port = basePort + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `Could not find an available port in range ${basePort}-${basePort + maxAttempts - 1}`
  );
}

async function main() {
  if (TRANSPORT === "http") {
    const port = await resolveHttpPort(BASE_HTTP_PORT, MAX_PORT_ATTEMPTS);
    const app = createMcpExpressApp();

    app.get("/", (_req: Request, res: Response) => {
      res.status(200).json({ name: "memorymesh", status: "ok", transport: "http", mcp_endpoint: "/mcp" });
    });

    // Her request → yeni server + yeni transport instance (stateless)
    app.all("/mcp", async (req: Request, res: Response) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("finish", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("HTTP transport request error:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    app.listen(port, () => {
      console.error(`MemoryMesh HTTP server running on http://localhost:${port}`);
      console.error("claude_desktop_config.json entry:");
      console.error(JSON.stringify({
        mcpServers: { memorymesh: { command: "npx", args: ["mcp-remote@next", `http://localhost:${port}/mcp`] } }
      }, null, 2));
    });
    return;
  }

  // stdio modu — tek server instance yeterli
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MemoryMesh MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
