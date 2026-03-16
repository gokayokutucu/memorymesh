import { IImporterGateway } from "../importer-gateway";
import { evaluateMessageForImport } from "./message-classifier";
import {
  IImportPolicy,
  IImportResult,
  IImportRunOptions,
  IGptConversation,
} from "./types";

export interface IImportPolicyDecision {
  should_import: boolean;
  existing_count: number;
  skip_reason?: string;
}

export async function importConversations(
  conversations: IGptConversation[],
  project: string,
  dryRun: boolean,
  gateway: IImporterGateway,
  options: IImportRunOptions = {}
): Promise<IImportResult> {
  const importPolicy = options.import_policy ?? "skip_existing";
  const conversationDelayMs = options.conversation_delay_ms ?? 0;
  const callbacks = options.callbacks;
  let saved = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};

  for (let conversationIndex = 0; conversationIndex < conversations.length; conversationIndex += 1) {
    const conversation = conversations[conversationIndex];
    let conversationSaved = 0;
    let conversationSkipped = 0;
    callbacks?.onConversationStart?.({
      conversation_index: conversationIndex + 1,
      total_conversations: conversations.length,
      title: conversation.title,
      message_count: conversation.messages.length,
    });

    for (let messageIndex = 0; messageIndex < conversation.messages.length; messageIndex += 1) {
      const message = conversation.messages[messageIndex];
      const absoluteMessageIndex = (conversation.message_offset ?? 0) + messageIndex;
      callbacks?.onMessageStart?.({
        conversation_title: conversation.title,
        role: message.role,
        message_index: absoluteMessageIndex,
        total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
        preview: buildPreview(message.content),
      });
      callbacks?.onMessageStageChange?.({
        conversation_title: conversation.title,
        role: message.role,
        message_index: absoluteMessageIndex,
        total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
        stage: "dedup",
      });
      const evaluation = evaluateMessageForImport(
        message,
        conversation.title,
        project,
        {
          message_index: absoluteMessageIndex,
          source_conversation_id: conversation.source_conversation_id,
        }
      );
      if (!evaluation.importable || !evaluation.payload) {
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "skipped",
        });
        const reason = evaluation.skip_reason ?? "unknown_skip_reason";
        skipped += 1;
        conversationSkipped += 1;
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
        callbacks?.onMessageSkipped?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          reason,
          preview: buildPreview(message.content),
        });
        continue;
      }

      const policyDecision = await resolveImportPolicyDecision(
        gateway,
        evaluation.payload,
        importPolicy
      );
      if (!policyDecision.should_import) {
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "skipped",
          ref_id: evaluation.payload.ref_id,
        });
        const reason = policyDecision.skip_reason ?? "policy_skip";
        skipped += 1;
        conversationSkipped += 1;
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
        callbacks?.onMessageSkipped?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          reason,
          preview: buildPreview(message.content),
          ref_id: evaluation.payload.ref_id,
          payload_bytes: Buffer.byteLength(evaluation.payload.content, "utf8"),
        });
        continue;
      }

      if (dryRun) {
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "completed",
          ref_id: evaluation.payload.ref_id,
        });
        saved += 1;
        conversationSaved += 1;
        callbacks?.onMessageImported?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          memory_type: evaluation.payload.memory_type,
          ref_id: evaluation.payload.ref_id,
          preview: buildPreview(message.content),
        });
        continue;
      }

      try {
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "save",
          ref_id: evaluation.payload.ref_id,
        });
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "embedding",
          stage_detail: buildEmbeddingStageDetail(evaluation.payload.content),
          ref_id: evaluation.payload.ref_id,
        });
        await gateway.saveMemory(evaluation.payload);
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "completed",
          ref_id: evaluation.payload.ref_id,
        });
        saved += 1;
        conversationSaved += 1;
          callbacks?.onMessageImported?.({
            conversation_title: conversation.title,
            role: message.role,
            message_index: absoluteMessageIndex,
            memory_type: evaluation.payload.memory_type,
            ref_id: evaluation.payload.ref_id,
          preview: buildPreview(message.content),
        });
      } catch (error) {
        callbacks?.onMessageStageChange?.({
          conversation_title: conversation.title,
          role: message.role,
          message_index: absoluteMessageIndex,
          total_messages: conversation.messages.length + (conversation.message_offset ?? 0),
          stage: "skipped",
          ref_id: evaluation.payload.ref_id,
        });
        const failure = extractSaveFailure(error);
        skipped += 1;
        conversationSkipped += 1;
        skippedReasons[failure.reason] = (skippedReasons[failure.reason] ?? 0) + 1;
          callbacks?.onMessageSkipped?.({
            conversation_title: conversation.title,
            role: message.role,
            message_index: absoluteMessageIndex,
            reason: failure.reason,
          preview: buildPreview(message.content),
          ref_id: evaluation.payload.ref_id,
          payload_bytes:
            failure.payload_bytes ??
            Buffer.byteLength(evaluation.payload.content, "utf8"),
        });
      }
    }

    callbacks?.onConversationComplete?.({
      conversation_index: conversationIndex + 1,
      total_conversations: conversations.length,
      title: conversation.title,
      saved: conversationSaved,
      skipped: conversationSkipped,
    });

    if (conversationDelayMs > 0 && conversationIndex < conversations.length - 1) {
      await sleep(conversationDelayMs);
    }
  }

  return {
    total_conversations: conversations.length,
    saved,
    skipped,
    skipped_reasons: skippedReasons,
  };
}

function extractSaveFailure(
  error: unknown
): { reason: string; payload_bytes?: number } {
  if (isRecord(error)) {
    const code = error.code;
    if (code === "payload_too_large") {
      return {
        reason: "payload_too_large",
        payload_bytes:
          typeof error.payload_bytes === "number" ? error.payload_bytes : undefined,
      };
    }
    if (code === "embedding_input_too_large") {
      return {
        reason: "embedding_input_too_large",
        payload_bytes:
          typeof error.payload_bytes === "number" ? error.payload_bytes : undefined,
      };
    }
    if (code === "partial_persistence") {
      return { reason: "partial_persistence" };
    }
    if (
      code === "qdrant_transient_failure" ||
      code === "mongo_transient_failure" ||
      code === "neo4j_transient_failure"
    ) {
      return { reason: code };
    }
    if (code === "save_status_pending_timeout") {
      return { reason: "save_status_pending_timeout" };
    }
  }
  return { reason: "save_failed" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function resolveImportPolicyDecision(
  gateway: IImporterGateway,
  payload: { ref_id?: string; project: string },
  policy: IImportPolicy
): Promise<IImportPolicyDecision> {
  if (!payload.ref_id) {
    return { should_import: true, existing_count: 0 };
  }

  const existing = await gateway.getMemoryByRef(payload.ref_id, payload.project);
  if (existing.length === 0) {
    return { should_import: true, existing_count: 0 };
  }

  if (policy === "import_anyway") {
    return { should_import: true, existing_count: existing.length };
  }

  // overwrite_existing is not yet safe across all stores; keep idempotent skip.
  if (policy === "overwrite_existing") {
    return {
      should_import: false,
      existing_count: existing.length,
      skip_reason: "overwrite_existing_not_supported",
    };
  }

  return {
    should_import: false,
    existing_count: existing.length,
    skip_reason: "duplicate_ref_id",
  };
}

function buildPreview(content: string, maxLength = 120): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildEmbeddingStageDetail(content: string): string | undefined {
  const rawMaxChars = Number.parseInt(
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS ?? "3500",
    10
  );
  const maxChars = Number.isNaN(rawMaxChars) || rawMaxChars <= 0 ? 3500 : rawMaxChars;
  const chunkCount = Math.max(1, Math.ceil(content.length / maxChars));
  if (chunkCount <= 1) {
    return undefined;
  }
  return `chunk 1/${chunkCount}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
