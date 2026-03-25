import { checkHttpHealth } from "../system/health";
import { ICommandRunner, ICommandRunOptions, ICommandResult } from "../system/command-runner";

class StubRunner implements ICommandRunner {
  constructor(private readonly response: ICommandResult) {}

  async run(
    _command: string,
    _args: string[] = [],
    _options?: ICommandRunOptions
  ): Promise<ICommandResult> {
    return this.response;
  }
}

describe("checkHttpHealth", () => {
  it("returns healthy for 200 JSON response", async () => {
    const runner = new StubRunner({
      stdout: '{"name":"memorymesh","status":"ok"}HTTPSTATUS:200',
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const result = await checkHttpHealth(runner, "http://localhost:3456/health");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Healthy");
  });

  it("reports missing endpoint when HTTP 404 is returned", async () => {
    const runner = new StubRunner({
      stdout: '{"error":"not found"}HTTPSTATUS:404',
      stderr: "",
      exitCode: 0,
      success: true,
    });

    const result = await checkHttpHealth(runner, "http://localhost:3456/health");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("missing");
    expect(result.message).toContain("404");
  });

  it("reports unreachable server when curl command fails", async () => {
    const runner = new StubRunner({
      stdout: "",
      stderr: "connection refused",
      exitCode: 7,
      success: false,
    });

    const result = await checkHttpHealth(runner, "http://localhost:3456/health");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("unreachable");
  });
});
