import { ensureQdrantCollectionDimension } from "../installer/qdrant-collection";
import { ICommandRunner } from "../system/command-runner";

class FakeRunner implements ICommandRunner {
  calls: string[] = [];

  constructor(
    private readonly map: Record<string, { code: number; stdout?: string }> = {}
  ) {}

  async run(command: string, args: string[] = []): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    success: boolean;
  }> {
    const key = `${command} ${args.join(" ")}`;
    this.calls.push(key);
    const mapped = this.map[key] ?? { code: 0, stdout: "" };
    return {
      stdout: mapped.stdout ?? "",
      stderr: mapped.code === 0 ? "" : "error",
      exitCode: mapped.code,
      success: mapped.code === 0,
    };
  }
}

describe("ensureQdrantCollectionDimension", () => {
  it("does nothing when the collection already matches the selected dimension", async () => {
    const runner = new FakeRunner({
      "curl -fsS http://localhost:6333/collections/memories": {
        code: 0,
        stdout:
          '{"result":{"config":{"params":{"vectors":{"size":1024,"distance":"Cosine"}}}}}',
      },
    });

    const result = await ensureQdrantCollectionDimension(runner, {
      collectionName: "memories",
      embeddingDimension: 1024,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: "unchanged",
      })
    );
    expect(runner.calls).toEqual([
      "curl -fsS http://localhost:6333/collections/memories",
    ]);
  });

  it("recreates the collection when the existing dimension is stale", async () => {
    const runner = new FakeRunner({
      "curl -fsS http://localhost:6333/collections/memories": {
        code: 0,
        stdout:
          '{"result":{"config":{"params":{"vectors":{"size":768,"distance":"Cosine"}}}}}',
      },
      "curl -fsS -X DELETE http://localhost:6333/collections/memories": { code: 0 },
      'curl -fsS -X PUT http://localhost:6333/collections/memories -H Content-Type: application/json -d {"vectors":{"size":1024,"distance":"Cosine"}}': {
        code: 0,
      },
    });

    const result = await ensureQdrantCollectionDimension(runner, {
      collectionName: "memories",
      embeddingDimension: 1024,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: "recreated",
      })
    );
    expect(runner.calls).toEqual([
      "curl -fsS http://localhost:6333/collections/memories",
      "curl -fsS -X DELETE http://localhost:6333/collections/memories",
      'curl -fsS -X PUT http://localhost:6333/collections/memories -H Content-Type: application/json -d {"vectors":{"size":1024,"distance":"Cosine"}}',
    ]);
  });
});
