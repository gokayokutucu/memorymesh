import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import * as net from "node:net";
import type { Request, Response } from "express";
import { z } from "zod";
import * as dotenv from "dotenv";
import {
  getMemoryStatus,
  getMemoryById,
  getMemoryByRef,
  getRelatedMemories,
  saveMemory,
  searchMemory,
  getProjects,
} from "./memory";

dotenv.config();

const TRANSPORT = process.env.TRANSPORT ?? "stdio";
const BASE_HTTP_PORT = Number(process.env.HTTP_PORT ?? "3456");
const MAX_PORT_ATTEMPTS = 10;
const MEMORY_TYPE_DESCRIPTION =
  "Use decision for architectural/technical choices; " +
  "learning for bugs found or lessons learned; " +
  "context for project setup/background/config; " +
  "preference for user workflow/style/tool preferences; " +
  "output for produced code blocks, emails, documents, or plans (store full text).";

/**
 * Her çağrıda araçlarla donatılmış yeni bir McpServer döner.
 * HTTP modunda her request kendi server+transport çiftini alır;
 * "Already connected" hatasını önler.
 */
function createServer(): McpServer {
  const server = new McpServer({ name: "memorymesh", version: "0.1.0" });

  server.tool(
    "save_memory",
    "Persist important information for future recall. Use this when the current turn creates durable value (decision, lesson, context, preference, or output artifact). For output memories, store full text; for non-output memories, store concise summaries.",
    {
      content: z.string().describe(
        "For memory_type='output': include the FULL content using these fencing rules:\n" +
        "- Markdown document or plain fence with no language tag -> wrap with ```markdown ... ```\n" +
        "- Inside a markdown block, ALL inner code blocks must use ~~~<lang> ... ~~~ (never ```)\n" +
        "- All other content (TypeScript, C#, Cypher, SQL, bash, etc.) -> ~~~<lang> ... ~~~\n" +
        "Backtick fences are ONLY used as the outermost markdown wrapper. Never nest ``` inside ```."
      ),
      project: z
        .string()
        .optional()
        .describe("Project name. Infer from context when possible; use \"general\" if unclear."),
      memory_type: z
        .enum(["decision", "learning", "context", "preference", "output"])
        .describe(MEMORY_TYPE_DESCRIPTION),
      importance: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Priority 1-10 for future retrieval. Use higher values for critical decisions, constraints, and high-impact outputs."),
      conversation_id: z
        .string()
        .optional()
        .describe("Conversation/session identifier to group memories from the same thread."),
      parent_memory_id: z
        .string()
        .optional()
        .describe("Direct parent memory id when this entry is a follow-up or refinement of an earlier memory."),
      derived_from_memory_id: z
        .string()
        .optional()
        .describe("Source memory id when this content is derived/transformed from another memory."),
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
        .enum(["code_block", "email", "document", "plan", "summary", "imported_conversation"])
        .optional()
        .describe(
          "Artifact type: code_block, email, document, plan, summary, or imported_conversation. Use output+source_type for exact raw retrieval workflows."
        ),
      created_at: z
        .string()
        .optional()
        .describe("Optional original creation timestamp in ISO-8601 format for imported memories."),
      source_agent: z
        .string()
        .optional()
        .describe("Optional source agent metadata, e.g. 'chatgpt'."),
      source_format: z
        .string()
        .optional()
        .describe("Optional source format metadata, e.g. 'gpt_export'."),
      message_index: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Optional source message index for imported conversation records."),
    },
    async ({
      content,
      project,
      memory_type,
      importance,
      conversation_id,
      parent_memory_id,
      derived_from_memory_id,
      tags,
      title,
      ref_id,
      source_type,
      created_at,
      source_agent,
      source_format,
      message_index,
    }) => {
      const result = saveMemory({
        content,
        project: project ?? "general",
        memory_type,
        importance,
        conversation_id,
        parent_memory_id,
        derived_from_memory_id,
        tags,
        title,
        ref_id,
        source_type,
        created_at,
        source_agent,
        source_format,
        message_index,
      });
      return {
        content: [
          { type: "text", text: `Saved with id: ${result.id} (indexing in background)` },
        ],
      };
    }
  );

  server.tool(
    "get_memory_status",
    "Inspect asynchronous save progress/outcome for an id returned by save_memory. Use this after background saves to verify persistence across stores.",
    {
      id: z.string().describe("Memory id returned by save_memory"),
    },
    async ({ id }) => {
      const status = getMemoryStatus(id);
      if (!status) {
        return {
          content: [{ type: "text", text: `No save status found for id: ${id}` }],
        };
      }
      const lines = [
        `id: ${status.id}`,
        `status: ${status.status}`,
        `qdrant_saved: ${status.qdrant_saved}`,
        `mongo_saved: ${status.mongo_saved}`,
        `neo4j_saved: ${status.neo4j_saved}`,
        `updated_at: ${status.updated_at}`,
      ];
      if (status.error) {
        lines.push(`error: ${status.error}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "search_memory",
    "Find candidate memories via semantic + graph-aware hybrid discovery. Use this when you know the topic but not the exact id/ref. For exact/raw retrieval, use get_memory or get_memory_by_ref.",
    {
      query: z.string().describe("What to search for"),
      project: z.string().optional().describe("Limit search to a specific project"),
      limit: z.number().optional().describe("Max results to return (default 5)"),
      tags: z.array(z.string()).optional().describe("Filter results by tags"),
      ref_id: z
        .string()
        .optional()
        .describe("Optional metadata filter by reference ID"),
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
          "relevance=hybrid ranking (semantic + recency + graph/tag/project boosts); recency=newest by created_at; oldest=oldest by created_at. Use oldest for origin/history questions and recency for latest-state questions."
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
          const outputContent = r.preview ?? r.content;
          const metadataParts = [
            r.ref_id ? `ref: ${r.ref_id}` : "",
            r.title ?? "",
          ].filter((item) => item.length > 0);
          const metadataPart =
            metadataParts.length > 0 ? ` | ${metadataParts.join(" | ")}` : "";
          const hybrid = (r.hybrid_score ?? r.semantic_score).toFixed(3);
          const semantic = r.semantic_score.toFixed(3);
          return `[${i + 1}] (${r.project} / ${r.memory_type} / hybrid_score: ${hybrid} / semantic_score: ${semantic})${tagsPart}${metadataPart}\n${outputContent}`;
        })
        .join("\n\n");
      return { content: [{ type: "text", text: formatted }] };
    }
  );

  server.tool(
    "get_memory",
    "Fetch one memory by internal id (exact lookup). Use this after search_memory when you already have an id and need definitive metadata/raw content.",
    {
      id: z.string().describe("Internal memory id"),
    },
    async ({ id }) => {
      const memory = await getMemoryById(id);
      if (!memory) {
        return { content: [{ type: "text", text: `Memory not found for id: ${id}` }] };
      }
      const body = memory.full_content ?? memory.content;
      const tags = memory.tags && memory.tags.length > 0 ? memory.tags.join(", ") : "-";
      const metadata = [
        `id: ${memory.id}`,
        `project: ${memory.project}`,
        `memory_type: ${memory.memory_type}`,
        `created_at: ${memory.created_at}`,
        `importance: ${memory.importance ?? "-"}`,
        `conversation_id: ${memory.conversation_id ?? "-"}`,
        `parent_memory_id: ${memory.parent_memory_id ?? "-"}`,
        `derived_from_memory_id: ${memory.derived_from_memory_id ?? "-"}`,
        `ref_id: ${memory.ref_id ?? "-"}`,
        `title: ${memory.title ?? "-"}`,
        `source_type: ${memory.source_type ?? "-"}`,
        `tags: ${tags}`,
      ].join("\n");
      return {
        content: [{ type: "text", text: `${metadata}\n\n${body}` }],
      };
    }
  );

  server.tool(
    "get_memory_by_ref",
    "Fetch memories by external/reference id (exact lookup). Use this for IDs like MM-012/TASK-001; returns newest-first with raw content when available.",
    {
      ref_id: z
        .string()
        .describe("Reference identifier, e.g. MM-012 or TASK-001"),
      project: z
        .string()
        .optional()
        .describe("Optional project filter"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default 10)"),
    },
    async ({ ref_id, project, limit }) => {
      const results = await getMemoryByRef({ ref_id, project, limit });
      const structuredMemories = results.map((r) => ({
        id: r.id,
        ref_id: r.ref_id ?? null,
        project: r.project,
        created_at: r.created_at,
        memory_type: r.memory_type,
        source_type: r.source_type ?? null,
      }));
      if (results.length === 0) {
        return {
          structuredContent: {
            ref_id,
            project: project ?? null,
            total: 0,
            memories: [],
          },
          content: [{ type: "text", text: `No memories found for ref_id: ${ref_id}` }],
        };
      }

      const formatted = results
        .map((r, i) => {
          const tags = r.tags && r.tags.length > 0 ? r.tags.join(", ") : "-";
          const metadata = [
            `[${i + 1}] id=${r.id}`,
            `project=${r.project}`,
            `type=${r.memory_type}`,
            `created_at=${r.created_at}`,
            `importance=${r.importance ?? "-"}`,
            `conversation_id=${r.conversation_id ?? "-"}`,
            `parent_memory_id=${r.parent_memory_id ?? "-"}`,
            `derived_from_memory_id=${r.derived_from_memory_id ?? "-"}`,
            `ref_id=${r.ref_id ?? "-"}`,
            `title=${r.title ?? "-"}`,
            `source_type=${r.source_type ?? "-"}`,
            `tags=${tags}`,
          ].join(" | ");
          const body = r.full_content ?? r.content;
          return `${metadata}\n${body}`;
        })
        .join("\n\n");

      return {
        structuredContent: {
          ref_id,
          project: project ?? null,
          total: structuredMemories.length,
          memories: structuredMemories,
        },
        content: [{ type: "text", text: formatted }],
      };
    }
  );

  server.tool(
    "get_related_memories",
    "Expand relationship-aware context from a known memory id. Use this after get_memory/search_memory when you need structurally related memories, not semantic discovery.",
    {
      id: z.string().describe("Source memory id to expand from"),
      limit: z
        .number()
        .optional()
        .describe("Maximum related memories to return (default 10)"),
    },
    async ({ id, limit }) => {
      const results = await getRelatedMemories({ id, limit });
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No related memories found for id: ${id}` }] };
      }

      const formatted = results
        .map((r, i) => {
          const tagsPart =
            r.tags && r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
          const metadataParts = [
            `id: ${r.id}`,
            `project: ${r.project}`,
            `type: ${r.memory_type}`,
            r.ref_id ? `ref: ${r.ref_id}` : "",
            r.title ? `title: ${r.title}` : "",
          ].filter((part) => part.length > 0);
          return `[${i + 1}] ${metadataParts.join(" | ")}${tagsPart}\n${r.preview ?? r.content}`;
        })
        .join("\n\n");

      return { content: [{ type: "text", text: formatted }] };
    }
  );

  server.tool(
    "list_projects",
    "Discover available project namespaces. Use this when project context is unclear before saving or searching.",
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
