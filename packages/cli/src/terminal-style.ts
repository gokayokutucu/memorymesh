export interface IStyle {
  heading(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  error(text: string): string;
  muted(text: string): string;
  renderTitle(): string;
}

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";

export function supportsAnsiColor(): boolean {
  if (process.env.NO_COLOR === "1") {
    return false;
  }
  if (process.env.FORCE_COLOR === "1") {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

function rgb(text: string, r: number, g: number, b: number): string {
  if (!supportsAnsiColor()) {
    return text;
  }
  return `\u001b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function bold(text: string): string {
  if (!supportsAnsiColor()) {
    return text;
  }
  return `${BOLD}${text}${RESET}`;
}

export function colorizeProgressLine(
  scope: "overall" | "file" | "message" | "heartbeat" | "success",
  text: string
): string {
  switch (scope) {
    case "overall":
      return rgb(text, 70, 170, 245);
    case "file":
      return rgb(text, 44, 200, 214);
    case "message":
      return rgb(text, 235, 196, 92);
    case "heartbeat":
      return rgb(text, 145, 168, 190);
    case "success":
      return rgb(text, 88, 214, 152);
    default:
      return text;
  }
}

function titleLines(): string[] {
  return [
    "███    ███ ███████ ███    ███  ██████  ██████  ██    ██ ███    ███ ███████ ███████ ██   ██",
    "████  ████ ██      ████  ████ ██    ██ ██   ██  ██  ██  ████  ████ ██      ██      ██   ██",
    "██ ████ ██ █████   ██ ████ ██ ██    ██ ██████    ████   ██ ████ ██ █████   ███████ ███████",
    "██  ██  ██ ██      ██  ██  ██ ██    ██ ██   ██    ██    ██  ██  ██ ██           ██ ██   ██",
    "██      ██ ███████ ██      ██  ██████  ██   ██    ██    ██      ██ ███████ ███████ ██   ██",
  ];
}

function colorizedTitleLines(lines: string[]): string[] {
  const palette: Array<[number, number, number]> = [
    [34, 90, 200],
    [28, 120, 215],
    [20, 150, 225],
    [16, 180, 220],
    [16, 200, 200],
  ];
  return lines.map((line, index) => {
    const [r, g, b] = palette[index];
    return rgb(line, r, g, b);
  });
}

export const style: IStyle = {
  heading(text: string): string {
    return bold(rgb(text, 90, 200, 255));
  },
  success(text: string): string {
    return rgb(text, 80, 210, 140);
  },
  warning(text: string): string {
    return rgb(text, 240, 210, 90);
  },
  error(text: string): string {
    return rgb(text, 235, 105, 105);
  },
  muted(text: string): string {
    return rgb(text, 145, 168, 190);
  },
  renderTitle(): string {
    const plainLines = titleLines();
    const maxLineWidth = plainLines.reduce(
      (max, line) => Math.max(max, line.length),
      0
    );
    const terminalWidth = process.stdout.columns;
    const horizontalPadding = 3;
    const innerWidth = maxLineWidth + horizontalPadding * 2;
    const frameWidth = innerWidth + 2;

    // If terminal is narrower than the banner box, preserve old non-box rendering.
    if (typeof terminalWidth === "number" && frameWidth >= terminalWidth) {
      return colorizedTitleLines(plainLines).join("\n");
    }

    const coloredLines = colorizedTitleLines(plainLines);
    const top = `┌${"─".repeat(innerWidth)}┐`;
    const bottom = `└${"─".repeat(innerWidth)}┘`;
    const framedLines = coloredLines.map((line) => `${" ".repeat(horizontalPadding)}${line}`);

    return [
      "",
      top,
      "",
      ...framedLines,
      "",
      bottom,
      "",
    ].join("\n");
  },
};
