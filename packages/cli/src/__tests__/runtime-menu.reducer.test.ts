import {
  applyPromptEvent,
  createTabCyclePromptState,
  ITabCyclePromptState,
  mapKeypressToEvent,
} from "../ui/runtime-menu";

describe("runtime menu prompt reducer", () => {
  it("submits typed value", () => {
    const state: ITabCyclePromptState = {
      value: "rust",
      selectionActive: false,
      cycleIndex: -1,
    };

    const { result } = applyPromptEvent(state, { type: "submit" }, { label: "Engine" });

    expect(result).toEqual({ status: "submit", value: "rust" });
  });

  it("submits default for empty optional input", () => {
    const state = createTabCyclePromptState();

    const { result } = applyPromptEvent(state, { type: "submit" }, {
      label: "Engine",
      defaultValue: "rust",
    });

    expect(result).toEqual({ status: "submit", value: "rust" });
  });

  it("returns retry for empty required input", () => {
    const state = createTabCyclePromptState();

    const { result } = applyPromptEvent(state, { type: "submit" }, {
      label: "Path",
      required: true,
    });

    expect(result).toEqual({ status: "retry" });
  });

  it("returns cancel result on cancel event", () => {
    const state = createTabCyclePromptState();

    const { result } = applyPromptEvent(state, { type: "cancel" }, { label: "Path" });

    expect(result).toEqual({ status: "cancel" });
  });

  it("integrates tab cycle through reducer", () => {
    let state = createTabCyclePromptState();

    state = applyPromptEvent(state, { type: "tab" }, {
      label: "Engine",
      tabCycleValues: ["rust", "ts"],
    }).state;
    expect(state.value).toBe("rust");

    state = applyPromptEvent(state, { type: "tab" }, {
      label: "Engine",
      tabCycleValues: ["rust", "ts"],
    }).state;
    expect(state.value).toBe("ts");
  });

  it("maps keypress events to prompt events", () => {
    expect(mapKeypressToEvent("", { ctrl: true, name: "c" })).toEqual({ type: "cancel" });
    expect(mapKeypressToEvent("", { name: "escape" })).toEqual({ type: "cancel" });
    expect(mapKeypressToEvent("", { name: "enter" })).toEqual({ type: "submit" });
    expect(mapKeypressToEvent("", { name: "tab" })).toEqual({ type: "tab" });
    expect(mapKeypressToEvent("", { name: "backspace" })).toEqual({ type: "backspace" });
    expect(mapKeypressToEvent("a", { name: "a" })).toEqual({ type: "char", char: "a" });
  });
});
