import {
  applyTabCyclePromptEvent,
  ClackRuntimeMenuUi,
  createTabCyclePromptState,
  getPromptFrameFinalizeText,
  getPromptFrameRepaintPrefix,
  renderPromptFrame,
} from "../ui/runtime-menu";

describe("runtime menu tab-cycle prompt state", () => {
  it("keeps placeholder state for path until tab, then activates remembered value", () => {
    const remembered = "/tmp/home/Downloads/last-started.zip";
    let state = createTabCyclePromptState();
    expect(state.value).toBe("");
    expect(state.cycleIndex).toBe(-1);

    state = applyTabCyclePromptEvent(
      state,
      { type: "tab" },
      [remembered]
    );
    expect(state.value).toBe(remembered);
    expect(state.selectionActive).toBe(true);
    expect(state.cycleIndex).toBe(0);
  });

  it("cycles engine prompt placeholder -> rust -> ts -> placeholder", () => {
    const values = ["rust", "ts"];
    let state = createTabCyclePromptState();
    expect(state.cycleIndex).toBe(-1);
    expect(state.value).toBe("");

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("rust");
    expect(state.cycleIndex).toBe(0);

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("ts");
    expect(state.cycleIndex).toBe(1);

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("");
    expect(state.cycleIndex).toBe(-1);
  });

  it("cycles import policy placeholder -> skip_existing -> import_anyway -> overwrite_existing -> placeholder", () => {
    const values = ["skip_existing", "import_anyway", "overwrite_existing"];
    let state = createTabCyclePromptState();

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("skip_existing");

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("import_anyway");

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("overwrite_existing");

    state = applyTabCyclePromptEvent(state, { type: "tab" }, values);
    expect(state.value).toBe("");
    expect(state.cycleIndex).toBe(-1);
  });

  it("manual typing overrides selected suggestion state", () => {
    let state = createTabCyclePromptState();
    state = applyTabCyclePromptEvent(
      state,
      { type: "tab" },
      ["rust", "ts"]
    );
    expect(state.value).toBe("rust");
    expect(state.selectionActive).toBe(true);

    state = applyTabCyclePromptEvent(state, { type: "char", char: "t" }, ["rust", "ts"]);
    state = applyTabCyclePromptEvent(state, { type: "char", char: "s" }, ["rust", "ts"]);
    expect(state.value).toBe("ts");
    expect(state.selectionActive).toBe(false);
    expect(state.cycleIndex).toBe(-1);
  });
});

describe("runtime menu promptInput", () => {
  const mockedText = jest.fn();
  const mockedIsCancel = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.doMock("@clack/prompts", () => ({
      text: mockedText,
      isCancel: mockedIsCancel,
    }));
  });

  afterEach(() => {
    jest.dontMock("@clack/prompts");
  });

  it("returns cancel on Ctrl+C/Esc cancel in fallback mode", async () => {
    mockedText.mockResolvedValue(Symbol("cancel"));
    mockedIsCancel.mockReturnValue(true);
    const ui = new ClackRuntimeMenuUi();
    const result = await ui.promptInput({ label: "Path", allowCancel: true });
    expect(result).toEqual({ status: "cancel" });
  });

  it("returns retry for required empty input", async () => {
    mockedText.mockResolvedValue("   ");
    mockedIsCancel.mockReturnValue(false);
    const ui = new ClackRuntimeMenuUi();
    const result = await ui.promptInput({ label: "Path", required: true, loop: false });
    expect(result).toEqual({ status: "retry" });
  });

  it("returns default value for optional empty input", async () => {
    mockedText.mockResolvedValue(" ");
    mockedIsCancel.mockReturnValue(false);
    const ui = new ClackRuntimeMenuUi();
    const result = await ui.promptInput({
      label: "Engine",
      required: false,
      defaultValue: "rust",
      loop: false,
    });
    expect(result).toEqual({ status: "submit", value: "rust" });
  });

  it("renders label and value on separate lines", () => {
    expect(renderPromptFrame("Engine", "rust")).toBe("? Engine\n  rust");
  });

  it("renders remembered path prompt on the same two-line frame", () => {
    expect(
      renderPromptFrame(
        "Path to ChatGPT export file/folder (Tab to accept)",
        "/tmp/home/Downloads/last-started.zip"
      )
    ).toBe(
      "? Path to ChatGPT export file/folder (Tab to accept)\n  /tmp/home/Downloads/last-started.zip"
    );
  });

  it("clips long prompt lines to a stable two-line frame", () => {
    expect(renderPromptFrame("Label", "1234567890", 5)).toBe("? La…\n  12…");
  });

  it("uses no repaint prefix on first render", () => {
    expect(getPromptFrameRepaintPrefix(false)).toBe("");
  });

  it("uses a fixed ANSI repaint prefix on rerender", () => {
    expect(getPromptFrameRepaintPrefix(true)).toBe("\x1b[1F\x1b[0J");
  });

  it("finalizes prompt frame with trailing newline", () => {
    expect(getPromptFrameFinalizeText()).toBe("\n");
  });

  it("keeps prompts separated after finalize (no inline concatenation)", () => {
    const first = renderPromptFrame("Engine (ts|rust, default: rust)", "rust");
    const second = renderPromptFrame(
      "Import policy (skip_existing|import_anyway|overwrite_existing, default: skip_existing)",
      "skip_existing"
    );
    expect(`${first}${getPromptFrameFinalizeText()}${second}`).toContain(
      "rust\n? Import policy"
    );
  });

  it("repaint prefix plus frame redraw does not duplicate the label", () => {
    const frame = renderPromptFrame("Engine (ts|rust, default: rust)", "rust", 80);
    expect(`${frame}${getPromptFrameRepaintPrefix(true)}${frame}`).toContain(
      "\x1b[1F\x1b[0J? Engine (ts|rust, default: rust)\n  rust"
    );
  });
});
