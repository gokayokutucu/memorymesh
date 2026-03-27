import { runWizard, WizardStep } from "../ui/wizard";

describe("wizard engine", () => {
  it("runs steps sequentially", async () => {
    const visited: string[] = [];
    const steps: WizardStep[] = [
      {
        id: "first",
        run: async () => {
          visited.push("first");
          return { type: "next" };
        },
      },
      {
        id: "second",
        run: async () => {
          visited.push("second");
          return { type: "next" };
        },
      },
    ];

    const result = await runWizard(steps);

    expect(result).toEqual({ data: {} });
    expect(visited).toEqual(["first", "second"]);
  });

  it("accumulates context data", async () => {
    const steps: WizardStep[] = [
      {
        id: "first",
        run: async () => ({
          type: "next",
          data: { project: "MemoryMesh" },
        }),
      },
      {
        id: "second",
        run: async (ctx) => ({
          type: "next",
          data: { engine: `${ctx.data.project as string}-rust` },
        }),
      },
    ];

    const result = await runWizard(steps);

    expect(result).toEqual({
      data: {
        project: "MemoryMesh",
        engine: "MemoryMesh-rust",
      },
    });
  });

  it("supports back navigation", async () => {
    let secondVisits = 0;
    const steps: WizardStep[] = [
      {
        id: "first",
        run: async () => ({
          type: "next",
          data: { started: true },
        }),
      },
      {
        id: "second",
        run: async () => {
          secondVisits += 1;
          if (secondVisits === 1) {
            return { type: "back" };
          }
          return {
            type: "next",
            data: { confirmed: true },
          };
        },
      },
    ];

    const result = await runWizard(steps);

    expect(secondVisits).toBe(2);
    expect(result).toEqual({
      data: {
        started: true,
        confirmed: true,
      },
    });
  });

  it("returns null on cancel", async () => {
    const steps: WizardStep[] = [
      {
        id: "first",
        run: async () => ({ type: "cancel" }),
      },
      {
        id: "second",
        run: async () => ({ type: "next" }),
      },
    ];

    const result = await runWizard(steps);

    expect(result).toBeNull();
  });
});
