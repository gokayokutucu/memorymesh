import { ICommandRunner } from "./command-runner";
import { IStackContext } from "./stack-context";

export interface ICheckResult {
  ok: boolean;
  message: string;
}

export interface IRetryPolicy {
  maxAttempts: number;
  delayMs: number;
}

function composeArgs(
  context: IStackContext,
  args: string[]
): string[] {
  return [
    "compose",
    "-f",
    context.composeFilePath,
    "--project-directory",
    context.projectDir,
    ...args,
  ];
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetries(
  policy: IRetryPolicy,
  action: (attempt: number) => Promise<ICheckResult>
): Promise<ICheckResult> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const result = await action(attempt);
    if (result.ok) {
      return result;
    }

    if (attempt < policy.maxAttempts) {
      await sleep(policy.delayMs);
    } else {
      return result;
    }
  }

  return {
    ok: false,
    message: "Retry policy exhausted unexpectedly.",
  };
}

export async function checkDockerInstalled(runner: ICommandRunner): Promise<ICheckResult> {
  const result = await runner.run("docker", ["--version"]);
  if (!result.success) {
    return {
      ok: false,
      message: "Docker is not installed or not on PATH.",
    };
  }

  return {
    ok: true,
    message: result.stdout || "Docker is available.",
  };
}

export async function checkDockerDaemon(runner: ICommandRunner): Promise<ICheckResult> {
  const result = await runner.run("docker", ["info"]);
  if (!result.success) {
    return {
      ok: false,
      message: "Docker daemon is not running.",
    };
  }

  return {
    ok: true,
    message: "Docker daemon is running.",
  };
}

export async function startOllamaService(
  runner: ICommandRunner,
  context: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv = {}
): Promise<ICheckResult> {
  const result = await runner.run("docker", composeArgs(context, ["up", "-d", "ollama"]), {
    env: { ...process.env, ...runtimeEnv },
  });
  if (!result.success) {
    return {
      ok: false,
      message: "Unable to start Docker Compose ollama service.",
    };
  }

  return {
    ok: true,
    message: "Ollama service started.",
  };
}

export async function waitForOllamaReady(
  runner: ICommandRunner,
  context: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv = {},
  retryPolicy: IRetryPolicy = { maxAttempts: 20, delayMs: 1500 }
): Promise<ICheckResult> {
  return withRetries(retryPolicy, async (attempt) => {
    const result = await runner.run(
      "docker",
      composeArgs(context, ["exec", "-T", "ollama", "ollama", "list"]),
      { env: { ...process.env, ...runtimeEnv } }
    );

    if (!result.success) {
      return {
        ok: false,
        message: `Ollama is not ready yet (attempt ${attempt}/${retryPolicy.maxAttempts}).`,
      };
    }

    return {
      ok: true,
      message: "Ollama is ready.",
    };
  });
}

export async function pullOllamaModel(
  runner: ICommandRunner,
  model: string,
  context: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv = {}
): Promise<ICheckResult> {
  const composeExec = await runner.run(
    "docker",
    composeArgs(context, ["exec", "-T", "ollama", "ollama", "pull", model]),
    { env: { ...process.env, ...runtimeEnv } }
  );
  if (!composeExec.success) {
    return {
      ok: false,
      message: `Unable to pull Ollama model ${model}.`,
    };
  }

  return {
    ok: true,
    message: `Ollama model pulled: ${model}`,
  };
}

export async function pullOllamaModelWithRetry(
  runner: ICommandRunner,
  model: string,
  context: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv = {},
  retryPolicy: IRetryPolicy = { maxAttempts: 3, delayMs: 2000 }
): Promise<ICheckResult> {
  return withRetries(retryPolicy, async (attempt) => {
    const result = await pullOllamaModel(runner, model, context, runtimeEnv);
    if (result.ok) {
      return result;
    }

    return {
      ok: false,
      message: `Unable to pull Ollama model ${model} (attempt ${attempt}/${retryPolicy.maxAttempts}).`,
    };
  });
}

export async function startMemoryMeshStack(
  runner: ICommandRunner,
  context: IStackContext,
  runtimeEnv: NodeJS.ProcessEnv = {},
  mode: "release-image" | "local-dev-build" = "release-image"
): Promise<ICheckResult> {
  if (mode === "release-image") {
    const pullResult = await runner.run("docker", composeArgs(context, ["pull"]), {
      env: { ...process.env, ...runtimeEnv },
    });
    if (!pullResult.success) {
      return {
        ok: false,
        message:
          "docker compose pull failed (release image mode). If you are validating locally before image publish, run with MEMORYMESH_USE_LOCAL_BUILD=true.",
      };
    }
  }

  const upArgs = mode === "local-dev-build" ? ["up", "-d", "--build"] : ["up", "-d"];
  const upResult = await runner.run("docker", composeArgs(context, upArgs), {
    env: { ...process.env, ...runtimeEnv },
  });
  if (!upResult.success) {
    return {
      ok: false,
      message:
        mode === "local-dev-build"
          ? "docker compose up -d --build failed (local-dev-build mode)."
          : "docker compose up -d failed.",
    };
  }

  return {
    ok: true,
    message:
      mode === "local-dev-build"
        ? "MemoryMesh stack started (local-dev-build mode)."
        : "MemoryMesh stack started (release-image mode).",
  };
}

export async function stopMemoryMeshStack(
  runner: ICommandRunner,
  context: IStackContext
): Promise<ICheckResult> {
  const result = await runner.run("docker", composeArgs(context, ["stop"]));
  if (!result.success) {
    return {
      ok: false,
      message: "docker compose stop failed.",
    };
  }

  return {
    ok: true,
    message: "MemoryMesh stack stopped.",
  };
}

export async function downMemoryMeshStack(
  runner: ICommandRunner,
  context: IStackContext,
  removeVolumes: boolean
): Promise<ICheckResult> {
  const args = removeVolumes
    ? ["down", "--volumes", "--remove-orphans"]
    : ["down", "--remove-orphans"];
  const result = await runner.run("docker", composeArgs(context, args));
  if (!result.success) {
    return {
      ok: false,
      message: "docker compose down failed.",
    };
  }

  return {
    ok: true,
    message: removeVolumes
      ? "MemoryMesh stack removed with volumes."
      : "MemoryMesh stack removed.",
  };
}

export async function checkServiceRunning(
  runner: ICommandRunner,
  context: IStackContext,
  serviceName: string
): Promise<ICheckResult> {
  const result = await runner.run(
    "docker",
    composeArgs(context, ["ps", "--status", "running", "--services"])
  );
  if (!result.success) {
    return {
      ok: false,
      message: "Unable to inspect docker compose services.",
    };
  }

  const services = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!services.includes(serviceName)) {
    return {
      ok: false,
      message: `${serviceName} is not running.`,
    };
  }

  return {
    ok: true,
    message: `${serviceName} is running.`,
  };
}

export async function verifySelectedEmbeddingModel(
  runner: ICommandRunner,
  context: IStackContext,
  selectedModel: string,
  runtimeEnv: NodeJS.ProcessEnv = {}
): Promise<ICheckResult> {
  const modelInMemoryMesh = await runner.run(
    "docker",
    composeArgs(context, [
      "exec",
      "-T",
      "memorymesh",
      "node",
      "-e",
      "process.stdout.write(process.env.EMBEDDING_MODEL ?? '')",
    ]),
    { env: { ...process.env, ...runtimeEnv } }
  );
  if (!modelInMemoryMesh.success) {
    return {
      ok: false,
      message: "Unable to read EMBEDDING_MODEL from memorymesh service.",
    };
  }

  const activeModel = modelInMemoryMesh.stdout.trim();
  if (activeModel !== selectedModel) {
    return {
      ok: false,
      message: `Selected model mismatch. expected=${selectedModel} actual=${activeModel || "empty"}.`,
    };
  }

  const ollamaModels = await runner.run(
    "docker",
    composeArgs(context, ["exec", "-T", "ollama", "ollama", "list"]),
    { env: { ...process.env, ...runtimeEnv } }
  );
  if (!ollamaModels.success) {
    return {
      ok: false,
      message: "Unable to list Ollama models for verification.",
    };
  }

  if (!ollamaModels.stdout.includes(selectedModel)) {
    return {
      ok: false,
      message: `Selected model ${selectedModel} not visible in Ollama model list.`,
    };
  }

  return {
    ok: true,
    message: `Selected embedding model verified: ${selectedModel}`,
  };
}
