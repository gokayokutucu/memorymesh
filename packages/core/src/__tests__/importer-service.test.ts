import {
  CancellationToken,
  classifyMessage,
  evaluateMessageForImport,
  importConversations,
  ImportInterruptedError,
  resolveImportPolicyDecision,
  parseConversations,
} from "../application/importer-service";
import { IImporterGateway } from "../application/importer-gateway";

describe("importer-service", () => {
  it("traverses mapping from root to current_node deterministically", () => {
    const raw = JSON.stringify([
      {
        id: "conv-1",
        title: "Conversation 1",
        current_node: "d",
        mapping: {
          d: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["Fourth"] },
              create_time: 4,
            },
            parent: "c",
            children: [],
          },
          b: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["Second"] },
              create_time: 2,
            },
            parent: "a",
            children: ["c"],
          },
          a: {
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["First"] },
              create_time: 1,
            },
            parent: null,
            children: ["b", "x"],
          },
          c: {
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["Third"] },
              create_time: 3,
            },
            parent: "b",
            children: ["d"],
          },
          x: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["Branch"] },
              create_time: 5,
            },
            parent: "a",
            children: [],
          },
        },
      },
    ]);

    const result = parseConversations(raw);
    expect(result[0].messages.map((m) => m.content)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
    expect(result[0].messages.every((m) => m.content !== "Branch")).toBe(true);
    expect(result[0].source_conversation_id).toBe("conv-1");
  });

  it("skips non-importable content types", () => {
    const raw = JSON.stringify([
      {
        title: "Conversation 2",
        current_node: "e",
        mapping: {
          a: {
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["Question"] },
            },
            parent: null,
            children: ["b"],
          },
          b: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "code", parts: ["hidden code block"] },
            },
            parent: "a",
            children: ["c"],
          },
          c: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "execution_output", parts: ["terminal output"] },
            },
            parent: "b",
            children: ["d"],
          },
          d: {
            message: {
              author: { role: "assistant" },
              content: {
                content_type: "tether_browsing_display",
                parts: ["browser card"],
              },
            },
            parent: "c",
            children: ["e"],
          },
          e: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["Final answer"] },
            },
            parent: "d",
            children: [],
          },
        },
      },
    ]);

    const result = parseConversations(raw);
    expect(result[0].messages.map((m) => m.content)).toEqual([
      "Question",
      "Final answer",
    ]);
  });

  it("classifies messages by role and assistant intent", () => {
    const userPayload = classifyMessage(
      { role: "user", content: "Can we use Redis?", create_time: 1710000000 },
      "Task: API",
      "MemoryMesh"
    );
    const outputPayload = classifyMessage(
      { role: "assistant", content: "```ts\nfunction handler() {}\n```" },
      "Task: API",
      "MemoryMesh"
    );
    const decisionPayload = classifyMessage(
      { role: "assistant", content: "Decision: we will use PostgreSQL for transactions." },
      "Task: API",
      "MemoryMesh"
    );
    const learningPayload = classifyMessage(
      { role: "assistant", content: "Root cause: race condition. Lesson learned from this bug." },
      "Task: API",
      "MemoryMesh"
    );
    const contextPayload = classifyMessage(
      { role: "assistant", content: "The system has three backend services behind an API gateway." },
      "Task: API",
      "MemoryMesh"
    );

    expect(userPayload.memory_type).toBe("context");
    expect(outputPayload.memory_type).toBe("output");
    expect(outputPayload.source_type).toBe("code_block");
    expect(decisionPayload.source_type).toBe("summary");
    expect(decisionPayload.memory_type).toBe("decision");
    expect(learningPayload.memory_type).toBe("learning");
    expect(contextPayload.memory_type).toBe("context");
    expect(userPayload.created_at).toBe("2024-03-09T16:00:00.000Z");
    expect(userPayload.tags).toEqual(
      expect.arrayContaining(["imported", "gpt-export", "source-agent-chatgpt", "source-format-gpt_export"])
    );
  });

  it("generates deterministic ref_id for repeated imports of the same message", () => {
    const first = classifyMessage(
      { role: "assistant", content: "Decision: use Postgres." },
      "Task: Storage",
      "MemoryMesh",
      { message_index: 3, source_conversation_id: "conv-42" }
    );
    const second = classifyMessage(
      { role: "assistant", content: "Decision: use Postgres." },
      "Task: Storage",
      "MemoryMesh",
      { message_index: 3, source_conversation_id: "conv-42" }
    );

    expect(first.ref_id).toBe(second.ref_id);
    expect(first.ref_id).toContain("import:chatgpt:gpt_export");
    expect(first.source_agent).toBe("chatgpt");
    expect(first.source_format).toBe("gpt_export");
    expect(first.message_index).toBe(3);
    expect(first.conversation_id).toBe("conv-42");
  });

  it("imports conversations via writer gateway", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => []),
    };

    const result = await importConversations(
      [
        {
          title: "T1",
          messages: [
            { role: "user", content: "hello" },
            { role: "system", content: "skip me" },
          ],
        },
      ],
      "MemoryMesh",
      false,
      gateway
    );

    expect(result).toEqual({
      total_conversations: 1,
      saved: 1,
      skipped: 1,
      skipped_reasons: { "unsupported_role:system": 1 },
    });
    expect(gateway.saveMemory).toHaveBeenCalledTimes(1);
  });

  it("continues importing when save fails with payload_too_large", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async (input) => {
        if (input.content.includes("too big")) {
          const error = new Error("payload_too_large");
          (error as Error & { code?: string; payload_bytes?: number }).code =
            "payload_too_large";
          (error as Error & { code?: string; payload_bytes?: number }).payload_bytes = 4096;
          throw error;
        }
      }),
      getMemoryByRef: jest.fn(async () => []),
    };

    const result = await importConversations(
      [
        {
          title: "T2",
          messages: [
            { role: "assistant", content: "too big artifact payload" },
            { role: "assistant", content: "Decision: use queue worker." },
          ],
        },
      ],
      "MemoryMesh",
      false,
      gateway
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skipped_reasons.payload_too_large).toBe(1);
  });

  it("does not treat partial persistence as imported", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async (input) => {
        if (input.content.includes("partial")) {
          const error = new Error("partial_persistence") as Error & {
            code?: string;
          };
          error.code = "partial_persistence";
          throw error;
        }
      }),
      getMemoryByRef: jest.fn(async () => []),
    };

    const result = await importConversations(
      [
        {
          title: "T3",
          messages: [
            { role: "assistant", content: "partial write happened" },
            { role: "assistant", content: "Decision: use queue worker." },
          ],
        },
      ],
      "MemoryMesh",
      false,
      gateway
    );

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.skipped_reasons.partial_persistence).toBe(1);
  });

  it("skip_existing policy avoids duplicates on repeated imports", async () => {
    const savedRefIds = new Set<string>();
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async (input) => {
        if (input.ref_id) {
          savedRefIds.add(input.ref_id);
        }
      }),
      getMemoryByRef: jest.fn(async (refId) => {
        if (savedRefIds.has(refId)) {
          return [
            {
              id: "existing-1",
              content: "existing",
              project: "MemoryMesh",
              memory_type: "context" as const,
              semantic_score: 1,
              similarity_score: 1,
              created_at: "2026-03-11T00:00:00.000Z",
            },
          ];
        }
        return [];
      }),
    };
    const conversations = [
      {
        title: "Conv",
        source_conversation_id: "conv-1",
        messages: [{ role: "assistant", content: "Decision: use Redis." }],
      },
    ];

    const first = await importConversations(
      conversations,
      "MemoryMesh",
      false,
      gateway,
      { import_policy: "skip_existing" }
    );
    const second = await importConversations(
      conversations,
      "MemoryMesh",
      false,
      gateway,
      { import_policy: "skip_existing" }
    );

    expect(first).toEqual({
      total_conversations: 1,
      saved: 1,
      skipped: 0,
      skipped_reasons: {},
    });
    expect(second).toEqual({
      total_conversations: 1,
      saved: 0,
      skipped: 1,
      skipped_reasons: { duplicate_ref_id: 1 },
    });
  });

  it("import_anyway policy imports duplicates", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => [
        {
          id: "existing-1",
          content: "existing",
          project: "MemoryMesh",
          memory_type: "context" as const,
          semantic_score: 1,
          similarity_score: 1,
          created_at: "2026-03-11T00:00:00.000Z",
        },
      ]),
    };
    const result = await importConversations(
      [
        {
          title: "Conv",
          source_conversation_id: "conv-1",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      false,
      gateway,
      { import_policy: "import_anyway" }
    );

    expect(result).toEqual({
      total_conversations: 1,
      saved: 1,
      skipped: 0,
      skipped_reasons: {},
    });
    expect(gateway.saveMemory).toHaveBeenCalledTimes(1);
  });

  it("keeps ref_id stable across repeated parse and classify runs", () => {
    const raw = JSON.stringify([
      {
        id: "conv-stable",
        title: "Stable Ref Test",
        current_node: "b",
        mapping: {
          a: {
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["Q1"] },
              create_time: 1710000000,
            },
            parent: null,
            children: ["b"],
          },
          b: {
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["Decision: use Postgres"] },
              create_time: 1710000001,
            },
            parent: "a",
            children: [],
          },
        },
      },
    ]);

    const run1 = parseConversations(raw);
    const run2 = parseConversations(raw);
    const p1 = classifyMessage(
      run1[0].messages[1],
      run1[0].title,
      "MemoryMesh",
      { message_index: 1, source_conversation_id: run1[0].source_conversation_id }
    );
    const p2 = classifyMessage(
      run2[0].messages[1],
      run2[0].title,
      "MemoryMesh",
      { message_index: 1, source_conversation_id: run2[0].source_conversation_id }
    );

    expect(p1.ref_id).toBe(p2.ref_id);
  });

  it("returns skip reason for unsupported roles", () => {
    const result = evaluateMessageForImport(
      { role: "system", content: "policy" },
      "T1",
      "MemoryMesh"
    );

    expect(result.importable).toBe(false);
    expect(result.skip_reason).toBe("unsupported_role:system");
  });

  it("returns duplicate skip reason from policy helper", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => [
        {
          id: "existing-1",
          content: "existing",
          project: "MemoryMesh",
          memory_type: "context" as const,
          semantic_score: 1,
          similarity_score: 1,
          created_at: "2026-03-11T00:00:00.000Z",
        },
      ]),
    };

    const decision = await resolveImportPolicyDecision(
      gateway,
      { ref_id: "import:chatgpt:gpt_export:conv:1:hash", project: "MemoryMesh" },
      "skip_existing"
    );

    expect(decision.should_import).toBe(false);
    expect(decision.skip_reason).toBe("duplicate_ref_id");
  });

  it("returns overwrite-not-supported skip reason from policy helper", async () => {
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => [
        {
          id: "existing-1",
          content: "existing",
          project: "MemoryMesh",
          memory_type: "context" as const,
          semantic_score: 1,
          similarity_score: 1,
          created_at: "2026-03-11T00:00:00.000Z",
        },
      ]),
    };

    const decision = await resolveImportPolicyDecision(
      gateway,
      { ref_id: "import:chatgpt:gpt_export:conv:1:hash", project: "MemoryMesh" },
      "overwrite_existing"
    );

    expect(decision.should_import).toBe(false);
    expect(decision.skip_reason).toBe("overwrite_existing_not_supported");
  });

  it("emits message stage callbacks during dedup and save flow", async () => {
    const stages: string[] = [];
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => []),
    };

    await importConversations(
      [
        {
          title: "Stage Conv",
          source_conversation_id: "conv-stage",
          messages: [{ role: "assistant", content: "Decision: use Redis." }],
        },
      ],
      "MemoryMesh",
      false,
      gateway,
      {
        callbacks: {
          onMessageStageChange: (context) => {
            stages.push(context.stage);
          },
        },
      }
    );

    expect(stages).toEqual(
      expect.arrayContaining(["dedup", "save", "embedding", "completed"])
    );
  });

  it("adds embedding chunk stage detail when content requires chunking", async () => {
    const stageDetails: Array<string | undefined> = [];
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => undefined),
      getMemoryByRef: jest.fn(async () => []),
    };
    const previousChunkSize = process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS;
    process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = "50";

    try {
      await importConversations(
        [
          {
            title: "Chunk Detail",
            source_conversation_id: "conv-chunk",
            messages: [{ role: "assistant", content: "a".repeat(220) }],
          },
        ],
        "MemoryMesh",
        false,
        gateway,
        {
          callbacks: {
            onMessageStageChange: (context) => {
              if (context.stage === "embedding") {
                stageDetails.push(context.stage_detail);
              }
            },
          },
        }
      );
    } finally {
      if (previousChunkSize === undefined) {
        delete process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS;
      } else {
        process.env.MEMORYMESH_EMBED_CHUNK_MAX_CHARS = previousChunkSize;
      }
    }

    expect(stageDetails).toContain("chunk 1/5");
  });

  it("stops starting new saves after cancellation is requested", async () => {
    const token = new CancellationToken();
    const gateway: IImporterGateway = {
      saveMemory: jest.fn(async () => {
        token.cancel();
      }),
      getMemoryByRef: jest.fn(async () => []),
    };

    await expect(
      importConversations(
        [
          {
            title: "Cancel Conv",
            messages: [
              { role: "assistant", content: "Decision: first" },
              { role: "assistant", content: "Decision: second" },
            ],
          },
        ],
        "MemoryMesh",
        false,
        gateway,
        { cancellation_token: token }
      )
    ).rejects.toBeInstanceOf(ImportInterruptedError);

    expect(gateway.saveMemory).toHaveBeenCalledTimes(1);
  });
});
