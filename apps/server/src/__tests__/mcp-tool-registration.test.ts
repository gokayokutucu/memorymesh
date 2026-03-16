import {
  formatMemoryMcpModeSummary,
  getRegisteredToolNames,
  getMemoryToolRegistrationPlan,
} from "../mcp-tool-registration";

describe("mcp tool registration plan", () => {
  const originalRead = process.env.MEMORYMESH_MEMORY_READ_ENABLED;
  const originalWrite = process.env.MEMORYMESH_MEMORY_WRITE_ENABLED;

  afterEach(() => {
    if (originalRead === undefined) {
      delete process.env.MEMORYMESH_MEMORY_READ_ENABLED;
    } else {
      process.env.MEMORYMESH_MEMORY_READ_ENABLED = originalRead;
    }

    if (originalWrite === undefined) {
      delete process.env.MEMORYMESH_MEMORY_WRITE_ENABLED;
    } else {
      process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = originalWrite;
    }
  });

  it("registers read and write tools in read-write mode", () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "true";
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "true";

    const plan = getMemoryToolRegistrationPlan();

    expect(plan.mode).toBe("READ_WRITE");
    expect(plan.readToolsEnabled).toBe(true);
    expect(plan.writeToolsEnabled).toBe(true);
    expect(plan.readToolNames).toContain("search_memory");
    expect(plan.writeToolNames).toContain("save_memory");
  });

  it("registers only read tools in read-only mode", () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "true";
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "false";

    const plan = getMemoryToolRegistrationPlan();

    expect(plan.mode).toBe("READ_ONLY");
    expect(plan.readToolsEnabled).toBe(true);
    expect(plan.writeToolsEnabled).toBe(false);
    const registered = getRegisteredToolNames(plan);
    expect(registered).toContain("search_memory");
    expect(registered).toContain("get_memory_by_ref");
    expect(registered).not.toContain("save_memory");
    expect(registered).toEqual(
      expect.arrayContaining([
        "get_runtime_health",
        "search_memory",
        "get_memory",
        "get_memory_by_ref",
        "get_related_memories",
        "list_projects",
      ])
    );
  });

  it("registers only write tools in write-only mode", () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "false";
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "true";

    const plan = getMemoryToolRegistrationPlan();

    expect(plan.mode).toBe("WRITE_ONLY");
    expect(plan.readToolsEnabled).toBe(false);
    expect(plan.writeToolsEnabled).toBe(true);
  });

  it("registers no memory tools in isolated mode", () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "false";
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "false";

    const plan = getMemoryToolRegistrationPlan();

    expect(plan.mode).toBe("ISOLATED");
    expect(plan.readToolsEnabled).toBe(false);
    expect(plan.writeToolsEnabled).toBe(false);
  });

  it("formats startup summary lines", () => {
    process.env.MEMORYMESH_MEMORY_READ_ENABLED = "true";
    process.env.MEMORYMESH_MEMORY_WRITE_ENABLED = "false";

    const summary = formatMemoryMcpModeSummary(getMemoryToolRegistrationPlan());

    expect(summary[0]).toBe("MemoryMesh MCP mode: READ_ONLY");
    expect(summary[1]).toBe("read tools: enabled");
    expect(summary[2]).toBe("write tools: disabled");
    expect(summary[3]).toContain("registered tools:");
    expect(summary[3]).not.toContain("save_memory");
  });
});
