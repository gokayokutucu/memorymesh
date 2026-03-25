import chalk from "chalk";
import ora, { Ora } from "ora";

export type EmbeddingModel = "nomic-embed-text" | "mxbai-embed-large";
export type DirtyStateAction = "clean_install" | "reuse_existing" | "exit";

export interface IDirtyStatePrompt {
  details: string[];
}

export interface IConfirmPrompt {
  message: string;
  initialValue?: boolean;
}

export interface IInstallerUi {
  intro(title: string): Promise<void>;
  outro(message: string): Promise<void>;
  note(message: string): Promise<void>;
  error(message: string): Promise<void>;
  confirm(input: IConfirmPrompt): Promise<boolean | null>;
  selectDirtyStateAction(input: IDirtyStatePrompt): Promise<DirtyStateAction | null>;
  selectEmbeddingModel(input?: {
    existingDimension: number | null;
  }): Promise<EmbeddingModel | null>;
  confirmClaudeIntegration(): Promise<boolean | null>;
}

export interface ISpinner {
  succeed(text: string): void;
  fail(text: string): void;
  stop(): void;
}

export interface ISpinnerFactory {
  start(text: string): ISpinner;
}

class OraSpinner implements ISpinner {
  constructor(private readonly spinner: Ora) {}

  succeed(text: string): void {
    this.spinner.succeed(text);
  }

  fail(text: string): void {
    this.spinner.fail(text);
  }

  stop(): void {
    this.spinner.stop();
  }
}

export class OraSpinnerFactory implements ISpinnerFactory {
  start(text: string): ISpinner {
    const spinner = ora({ text }).start();
    return new OraSpinner(spinner);
  }
}

export class ClackInstallerUi implements IInstallerUi {
  async intro(title: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.intro(chalk.cyan(title));
  }

  async outro(message: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.outro(chalk.green(message));
  }

  async note(message: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.log.message(chalk.gray(message));
  }

  async error(message: string): Promise<void> {
    const clack = await import("@clack/prompts");
    clack.log.error(chalk.red(message));
  }

  async confirm(input: IConfirmPrompt): Promise<boolean | null> {
    const clack = await import("@clack/prompts");
    const answer = await clack.confirm({
      message: input.message,
      initialValue: input.initialValue ?? false,
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer;
  }

  async selectDirtyStateAction(
    input: IDirtyStatePrompt
  ): Promise<DirtyStateAction | null> {
    const clack = await import("@clack/prompts");
    const detailText = input.details.length > 0
      ? input.details.map((line) => `- ${line}`).join("\n")
      : "- Existing local MemoryMesh state was detected.";
    clack.log.warn(chalk.yellow("Existing MemoryMesh data detected."));
    clack.log.message(
      chalk.gray(
        "This may indicate a previous installation was not fully removed.\n" +
        "Continuing may reuse old state.\n" +
        detailText
      )
    );

    const answer = await clack.select({
      message: "How should setup continue?",
      options: [
        {
          value: "clean_install",
          label: "Clean install",
          hint: "remove managed MemoryMesh state, then continue",
        },
        {
          value: "reuse_existing",
          label: "Reuse existing data",
          hint: "continue setup with current state",
        },
        {
          value: "exit",
          label: "Exit",
          hint: "stop setup now",
        },
      ],
      initialValue: "reuse_existing",
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer as DirtyStateAction;
  }

  async selectEmbeddingModel(input?: {
    existingDimension: number | null;
  }): Promise<EmbeddingModel | null> {
    const clack = await import("@clack/prompts");

    const existing = input?.existingDimension ?? null;

    function labelForFlash(): string {
      if (existing === 768) {
        return "Flash (nomic-embed-text, 768) — Recommended (matches existing data)";
      }
      if (existing && existing !== 768) {
        return "Flash (nomic-embed-text, 768)";
      }
      return "Flash (nomic-embed-text, 768)";
    }

    function labelForMedium(): string {
      if (existing === 1024) {
        return "Medium (mxbai-embed-large, 1024) — Recommended (matches existing data)";
      }
      if (existing && existing !== 1024) {
        return "Medium (mxbai-embed-large, 1024) — Will require reset";
      }
      return "Medium (mxbai-embed-large, 1024)";
    }

    const answer = await clack.select({
      message: "Select embedding model",
      options: [
        {
          value: "nomic-embed-text",
          label: labelForFlash(),
        },
        {
          value: "mxbai-embed-large",
          label: labelForMedium(),
        },
      ],
      initialValue: existing === 1024 ? "mxbai-embed-large" : "nomic-embed-text",
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer as EmbeddingModel;
  }

  async confirmClaudeIntegration(): Promise<boolean | null> {
    const clack = await import("@clack/prompts");
    const answer = await clack.confirm({
      message: "Add MemoryMesh MCP integration?",
      initialValue: true,
    });

    if (clack.isCancel(answer)) {
      return null;
    }

    return answer;
  }
}
