import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as net from "node:net";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import * as dotenv from "dotenv";
import { saveMemory, searchMemory, getProjects } from "./memory";

dotenv.config();

const server = new McpServer({
  name: "memorymesh",
  version: "0.1.0",
});

const TRANSPORT = process.env.TRANSPORT ?? "stdio";
const BASE_HTTP_PORT = Number(process.env.HTTP_PORT ?? "3456");
const MAX_PORT_ATTEMPTS = 10;

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

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probeServer = net.createServer();
    probeServer.once("error", () => resolve(false));
    probeServer.once("listening", () => {
      probeServer.close();
      resolve(true);
    });
    probeServer.listen(port);
  });
}

async function resolveHttpPort(
  basePort: number,
  maxAttempts: number
): Promise<number> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const port = basePort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(
    `Could not find an available port in range ${basePort}-${basePort + maxAttempts - 1}`
  );
}

async function main() {
  if (TRANSPORT === "http") {
    const port = await resolveHttpPort(BASE_HTTP_PORT, MAX_PORT_ATTEMPTS);
    const app = createMcpExpressApp();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await server.connect(transport);

    app.get("/", (_req: Request, res: Response) => {
      res.status(200).json({
        name: "memorymesh",
        status: "ok",
        transport: "http",
        mcp_endpoint: "/mcp",
      });
    });

    app.all("/mcp", async (req: Request, res: Response) => {
      try {
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
      console.error("Add to claude_desktop_config.json:");
      console.error(
        JSON.stringify(
          {
            mcpServers: {
              memorymesh: {
                command: "npx",
                args: ["mcp-remote@next", `http://localhost:${port}/mcp`],
              },
            },
          },
          null,
          2
        )
      );
    });
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MemoryMesh MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
