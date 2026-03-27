import {
  classifyJsonFileContent,
  classifyParsedJson,
} from "../json-shape-classifier";

describe("json-shape-classifier", () => {
  it("classifies supported conversation schema", () => {
    const content = JSON.stringify([
      {
        mapping: { a: {} },
        current_node: "a",
      },
    ]);

    const result = classifyJsonFileContent("/tmp/conversations.json", content);
    expect(result.category).toBe("supported_conversation_file");
  });

  it("classifies unsupported group chat schema", () => {
    const parsed = {
      chats: [
        {
          messages: [{ text: "hello" }],
        },
      ],
    };

    const result = classifyParsedJson("/tmp/group_chats.json", parsed);
    expect(result.category).toBe("unsupported_conversation_schema");
  });

  it("classifies ignorable json by support metadata shape", () => {
    const result = classifyParsedJson("/tmp/settings.json", { settings: { theme: "dark" } });
    expect(result.category).toBe("ignorable_json");
  });

  it("classifies export manifest object as ignorable", () => {
    const result = classifyParsedJson("/tmp/export_manifest.json", {
      export_files: [],
      logical_files: [],
      manifest_file: "export_manifest.json",
      version: "1",
    });
    expect(result.category).toBe("ignorable_json");
  });

  it("classifies support arrays as ignorable", () => {
    const shared = classifyParsedJson("/tmp/shared_conversations.json", [
      { id: "1", conversation_id: "c1", is_anonymous: false, title: "t" },
    ]);
    const feedback = classifyParsedJson("/tmp/message_feedback.json", [
      { evaluation_name: "quality", rating: "thumbs_up", conversation_id: "c1" },
    ]);
    const userSettings = classifyParsedJson("/tmp/user_settings.json", [
      { user_id: "u1", settings: {} },
    ]);

    expect(shared.category).toBe("ignorable_json");
    expect(feedback.category).toBe("ignorable_json");
    expect(userSettings.category).toBe("ignorable_json");
  });

  it("classifies unknown json shape", () => {
    const result = classifyParsedJson("/tmp/data.json", { a: 1, b: 2 });
    expect(result.category).toBe("unknown_json");
  });

  it("does not classify by filename alone", () => {
    const result = classifyParsedJson("/tmp/manifest.json", { a: 1, b: 2 });
    expect(result.category).toBe("unknown_json");
  });

  it("classifies invalid json", () => {
    const result = classifyJsonFileContent("/tmp/broken.json", "{ not-json }");
    expect(result.category).toBe("invalid_json");
  });
});
