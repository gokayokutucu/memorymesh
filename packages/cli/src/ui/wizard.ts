export type WizardContext = {
  data: Record<string, unknown>;
};

export type StepResult =
  | { type: "next"; data?: Record<string, unknown> }
  | { type: "back" }
  | { type: "cancel" };

export type WizardStep = {
  id: string;
  run: (ctx: WizardContext) => Promise<StepResult>;
};

export async function runWizard(steps: WizardStep[]): Promise<WizardContext | null> {
  const ctx: WizardContext = { data: {} };
  let index = 0;

  while (index >= 0 && index < steps.length) {
    const step = steps[index];
    const result = await step.run(ctx);

    if (result.type === "cancel") {
      return null;
    }

    if (result.type === "back") {
      index = Math.max(0, index - 1);
      continue;
    }

    if (result.type === "next") {
      if (result.data) {
        Object.assign(ctx.data, result.data);
      }
      index += 1;
      continue;
    }
  }

  return ctx;
}
