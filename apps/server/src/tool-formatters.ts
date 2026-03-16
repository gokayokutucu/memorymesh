import { ISaveMemoryResult, ISearchResult } from "@memorymesh/core";

export function formatSaveMemoryToolText(result: ISaveMemoryResult): string {
  if (result.status === "skipped") {
    return JSON.stringify({
      status: "skipped",
      reason: result.reason ?? "memory_write_disabled",
    });
  }

  if (result.status === "failed") {
    return JSON.stringify({
      status: "failed",
      error_code: result.error_code ?? "save_failed",
      payload_bytes: result.payload_bytes ?? null,
      max_payload_bytes: result.max_payload_bytes ?? null,
    });
  }

  return JSON.stringify({
    id: result.id,
    status: result.status,
  });
}

export function formatSearchMemoryToolText(results: ISearchResult[]): string {
  if (results.length === 0) {
    return JSON.stringify({ results: [] });
  }

  return results
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
}

export interface IRuntimeHealthToolPayload {
  mode: string;
  read_tools_enabled: boolean;
  write_tools_enabled: boolean;
  registered_tools: string[];
  stores: Record<
    "qdrant" | "mongo" | "neo4j",
    {
      store: "qdrant" | "mongo" | "neo4j";
      state: "healthy" | "degraded" | "open";
      consecutive_failures: number;
      last_error?: string;
      last_failure_at?: string;
      opened_until?: string;
    }
  >;
}

export function formatRuntimeHealthToolText(
  payload: IRuntimeHealthToolPayload
): string {
  return JSON.stringify(payload);
}
