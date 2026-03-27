import { ApprovalOptions, ApprovalResult } from "./approval";

export type RuntimeAction =
  | "import_chatgpt"
  | "import_documents"
  | "search_memories"
  | "start_mcp_server"
  | "settings"
  | "doctor"
  | "exit";

export interface IRuntimeMenuUi {
  intro(title: string): Promise<void>;
  outro(message: string): Promise<void>;
  note(message: string): Promise<void>;
  promptApproval(options: ApprovalOptions): Promise<ApprovalResult>;
  selectAction(): Promise<RuntimeAction | null>;
  promptInput(options: PromptInputOptions): Promise<PromptResult>;
  promptText(
    message: string,
    placeholder?: string,
    options?: IRuntimeTextPromptOptions
  ): Promise<string | null>;
  selectEmbeddingMode(currentMode: "flash" | "medium"): Promise<"flash" | "medium" | null>;
}

export interface IRuntimeTextPromptOptions {
  tabCycleValues?: string[];
}

export type PromptResult =
  | { status: "submit"; value: string }
  | { status: "cancel" }
  | { status: "retry" };

export interface PromptInputOptions {
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  tabCycleValues?: string[];
  allowCancel?: boolean;
  loop?: boolean;
}

export type PromptEvent =
  | { type: "submit" }
  | { type: "cancel" }
  | { type: "tab" }
  | { type: "backspace" }
  | { type: "char"; char: string };

export interface ITabCyclePromptState {
  value: string;
  cycleIndex: number;
  selectionActive: boolean;
}

export type ITabCyclePromptEvent =
  | { type: "tab" }
  | { type: "char"; char: string }
  | { type: "backspace" };

export function createTabCyclePromptState(): ITabCyclePromptState {
  return {
    value: "",
    cycleIndex: -1,
    selectionActive: false,
  };
}

const PROMPT_FRAME_LINE_COUNT = 2;

export function applyTabCyclePromptEvent(
  state: ITabCyclePromptState,
  event: ITabCyclePromptEvent,
  tabCycleValues: readonly string[]
): ITabCyclePromptState {
  if (event.type === "tab") {
    if (tabCycleValues.length === 0) {
      return state;
    }
    const nextIndex = state.cycleIndex + 1 >= tabCycleValues.length
      ? -1
      : state.cycleIndex + 1;
    if (nextIndex === -1) {
      return {
        value: "",
        cycleIndex: -1,
        selectionActive: false,
      };
    }
    return {
      value: tabCycleValues[nextIndex],
      cycleIndex: nextIndex,
      selectionActive: true,
    };
  }

  if (event.type === "char") {
    if (state.selectionActive) {
      return {
        value: event.char,
        cycleIndex: -1,
        selectionActive: false,
      };
    }

    return {
      value: `${state.value}${event.char}`,
      cycleIndex: -1,
      selectionActive: false,
    };
  }

  if (!state.value) {
    return state;
  }

  if (state.selectionActive) {
    return {
      value: "",
      cycleIndex: -1,
      selectionActive: false,
    };
  }

  return {
    value: state.value.slice(0, -1),
    cycleIndex: -1,
    selectionActive: false,
  };
}

function truncatePromptDisplay(value: string, maxColumns: number): string {
  if (maxColumns <= 0) {
    return "";
  }
  const visible = stripAnsi(value);
  if (visible.length <= maxColumns) {
    return value;
  }
  if (maxColumns === 1) {
    return visible.slice(0, 1);
  }
  return `${visible.slice(0, maxColumns - 1)}…`;
}

export function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function renderPromptFrame(
  label: string,
  shownValue: string,
  columns = 80
): string {
  const safeColumns = Math.max(columns, 4);
  const labelText = truncatePromptDisplay(`? ${label}`, safeColumns);
  const valueText = truncatePromptDisplay(`  ${shownValue}`, safeColumns);
  return `${labelText}\n${valueText}`;
}

export function getPromptFrameRepaintPrefix(hasRenderedBefore: boolean): string {
  if (!hasRenderedBefore) {
    return "";
  }
  return "\x1b[1F\x1b[0J";
}

export function getPromptFrameFinalizeText(): string {
  return "\n";
}

export function mapKeypressToEvent(
  chunk: string,
  key: { name?: string; ctrl?: boolean; meta?: boolean }
): PromptEvent | null {
  if (key.ctrl && key.name === "c") return { type: "cancel" };
  if (key.name === "escape") return { type: "cancel" };
  if (key.name === "return" || key.name === "enter") return { type: "submit" };
  if (key.name === "tab") return { type: "tab" };
  if (key.name === "backspace") return { type: "backspace" };

  if (!key.ctrl && !key.meta && chunk && chunk.length === 1) {
    return { type: "char", char: chunk };
  }

  return null;
}

export function applyPromptEvent(
  state: ITabCyclePromptState,
  event: PromptEvent,
  options: PromptInputOptions
): {
  state: ITabCyclePromptState;
  result?: PromptResult;
} {
  switch (event.type) {
    case "cancel":
      return { state, result: { status: "cancel" } };

    case "submit": {
      const trimmed = state.value.trim();

      if (!trimmed) {
        if (options.required) {
          return { state, result: { status: "retry" } };
        }

        return {
          state,
          result: {
            status: "submit",
            value: options.defaultValue ?? "",
          },
        };
      }

      return {
        state,
        result: { status: "submit", value: trimmed },
      };
    }

    case "tab":
      return {
        state: applyTabCyclePromptEvent(
          state,
          { type: "tab" },
          options.tabCycleValues ?? []
        ),
      };

    case "backspace":
      return {
        state: applyTabCyclePromptEvent(
          state,
          { type: "backspace" },
          options.tabCycleValues ?? []
        ),
      };

    case "char":
      return {
        state: applyTabCyclePromptEvent(
          state,
          { type: "char", char: event.char },
          options.tabCycleValues ?? []
        ),
      };
  }
}

export class ClackRuntimeMenuUi implements IRuntimeMenuUi {
  async intro(title: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.intro(title);
  }

  async outro(message: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.outro(message);
  }

  async note(message: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.log.message(message);
  }

  async promptApproval(options: ApprovalOptions): Promise<ApprovalResult> {
    const clack = await import("@clack/prompts");
    clack.log.warn(options.title);
    if (options.bodyLines.length > 0) {
      clack.log.message(options.bodyLines.join("\n"));
    }

    const answer = await clack.select({
      message: "Confirm action",
      options: [
        {
          value: "approve",
          label: options.confirmLabel ?? "Yes",
        },
        {
          value: "reject",
          label: options.rejectLabel ?? "No",
        },
      ],
      initialValue: "reject",
    });

    if (clack.isCancel(answer)) {
      if (options.allowCancel === false) {
        return { status: "rejected" };
      }
      return { status: "cancelled" };
    }

    return answer === "approve"
      ? { status: "approved" }
      : { status: "rejected" };
  }

  async selectAction(): Promise<RuntimeAction | null> {
    const clack = await import("@clack/prompts");
    const answer = await clack.select({
      message: "MemoryMesh",
      options: [
        { value: "import_chatgpt", label: "Import ChatGPT archive" },
        { value: "import_documents", label: "Import documents" },
        { value: "search_memories", label: "Search memories" },
        { value: "start_mcp_server", label: "Start MCP bridge" },
        { value: "settings", label: "Settings" },
        { value: "doctor", label: "Doctor" },
        { value: "exit", label: "Exit" },
      ],
      initialValue: "import_chatgpt",
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer as RuntimeAction;
  }

  async promptInput(options: PromptInputOptions): Promise<PromptResult> {
    const required = options.required ?? false;
    const allowCancel = options.allowCancel ?? true;
    const loop = options.loop ?? true;

    while (true) {
      const result = await this.promptInputSingle(options);

      if (result.status === "cancel" && !allowCancel) {
        if (loop) {
          continue;
        }
        return { status: "retry" };
      }

      if (result.status !== "retry" || !loop) {
        return result;
      }
      if (!required) {
        return result;
      }
    }
  }

  private async promptInputSingle(options: PromptInputOptions): Promise<PromptResult> {
    const label = options.label;
    const placeholder = options.placeholder ?? "";
    const required = options.required ?? false;
    const defaultValue = options.defaultValue;
    const tabCycleValues = options.tabCycleValues ?? [];

    if (tabCycleValues.length === 0 || !process.stdin.isTTY || !process.stdout.isTTY) {
      const clack = await import("@clack/prompts");
      const answer = await clack.text({
        message: label,
        placeholder,
      });

      if (clack.isCancel(answer)) {
        return { status: "cancel" };
      }

      const raw = typeof answer === "string" ? answer : "";
      const trimmed = raw.trim();
      if (!trimmed) {
        if (required) {
          return { status: "retry" };
        }
        return { status: "submit", value: defaultValue ?? "" };
      }

      return { status: "submit", value: trimmed };
    }

    const readline = await import("node:readline");
    const stdin = process.stdin;
    const stdout = process.stdout;
    const dim = (value: string): string => `\x1b[2m${value}\x1b[22m`;
    let state = createTabCyclePromptState();
    let hasRendered = false;

    return await new Promise<PromptResult>((resolve) => {
      readline.emitKeypressEvents(stdin);
      const previousRawMode = stdin.isRaw;
      stdin.setRawMode?.(true);
      stdin.resume();

      const render = (): void => {
        const shownValue = state.value || (placeholder ? dim(placeholder) : "");
        stdout.write(getPromptFrameRepaintPrefix(hasRendered));
        stdout.write(renderPromptFrame(label, shownValue, stdout.columns ?? 80));
        hasRendered = true;
      };

      const cleanup = (): void => {
        stdin.off("keypress", onKeypress);
        if (previousRawMode === false) {
          stdin.setRawMode?.(false);
        }
      };

      const finalize = (): void => {
        if (!hasRendered) {
          return;
        }
        stdout.write(getPromptFrameFinalizeText());
      };

      const onKeypress = (
        chunk: string,
        key: { name?: string; ctrl?: boolean; meta?: boolean }
      ): void => {
        const event = mapKeypressToEvent(chunk, key);
        if (!event) {
          return;
        }

        const reduced = applyPromptEvent(state, event, {
          ...options,
          required,
          defaultValue,
          tabCycleValues,
        });
        state = reduced.state;

        if (reduced.result) {
          cleanup();
          finalize();
          resolve(reduced.result);
          return;
        }

        render();
      };

      render();
      stdin.on("keypress", onKeypress);
    });
  }

  async promptText(
    message: string,
    placeholder = "",
    options?: IRuntimeTextPromptOptions
  ): Promise<string | null> {
    const result = await this.promptInput({
      label: message,
      placeholder,
      tabCycleValues: options?.tabCycleValues,
      required: false,
      loop: false,
    });
    if (result.status === "cancel") {
      return null;
    }
    if (result.status === "retry") {
      return "";
    }
    return result.value;
  }

  async selectEmbeddingMode(
    currentMode: "flash" | "medium"
  ): Promise<"flash" | "medium" | null> {
    const clack = await import("@clack/prompts");
    const answer = await clack.select({
      message: "Select embedding mode",
      options: [
        { value: "flash", label: "Flash", hint: "fast local embedding" },
        { value: "medium", label: "Medium", hint: "better semantic search" },
      ],
      initialValue: currentMode,
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer as "flash" | "medium";
  }
}
