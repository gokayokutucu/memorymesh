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
      const evaluation = evaluateMessageForImport(
        message,
        conversation.title,
        project,
        {
          message_index: messageIndex,
          source_conversation_id: conversation.source_conversation_id,
        }
      );
      if (!evaluation.importable || !evaluation.payload) {
        const reason = evaluation.skip_reason ?? "unknown_skip_reason";
        skipped += 1;
        conversationSkipped += 1;
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
        callbacks?.onMessageSkipped?.({
          conversation_title: conversation.title,
          role: message.role,
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
        const reason = policyDecision.skip_reason ?? "policy_skip";
        skipped += 1;
        conversationSkipped += 1;
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
        callbacks?.onMessageSkipped?.({
          conversation_title: conversation.title,
          role: message.role,
          reason,
          preview: buildPreview(message.content),
        });
        continue;
      }

      if (dryRun) {
        saved += 1;
        conversationSaved += 1;
        callbacks?.onMessageImported?.({
          conversation_title: conversation.title,
          role: message.role,
          memory_type: evaluation.payload.memory_type,
          preview: buildPreview(message.content),
        });
        continue;
      }

      await gateway.saveMemory(evaluation.payload);
      saved += 1;
      conversationSaved += 1;
      callbacks?.onMessageImported?.({
        conversation_title: conversation.title,
        role: message.role,
        memory_type: evaluation.payload.memory_type,
        preview: buildPreview(message.content),
      });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
