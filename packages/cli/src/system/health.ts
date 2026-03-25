import { ICommandRunner } from "./command-runner";
import { ICheckResult } from "./docker";

const CURL_STATUS_MARKER = "HTTPSTATUS:";

function parseCurlResponse(stdout: string): { statusCode: number; body: string } | null {
  const markerIndex = stdout.lastIndexOf(CURL_STATUS_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  const body = stdout.slice(0, markerIndex).trim();
  const statusRaw = stdout.slice(markerIndex + CURL_STATUS_MARKER.length).trim();
  const statusCode = Number(statusRaw);
  if (!Number.isFinite(statusCode)) {
    return null;
  }

  return { statusCode, body };
}

export async function checkHttpHealth(
  runner: ICommandRunner,
  url: string
): Promise<ICheckResult> {
  const result = await runner.run("curl", [
    "-sS",
    "-m",
    "5",
    "-H",
    "Accept: application/json",
    "-w",
    `${CURL_STATUS_MARKER}%{http_code}`,
    url,
  ]);

  if (!result.success) {
    return {
      ok: false,
      message: `Server unreachable: ${url}`,
    };
  }

  const parsed = parseCurlResponse(result.stdout);
  if (!parsed) {
    return {
      ok: false,
      message: `Health probe returned an unparseable response: ${url}`,
    };
  }

  if (parsed.statusCode === 404) {
    return {
      ok: false,
      message: `Health endpoint missing at ${url} (HTTP 404).`,
    };
  }

  if (parsed.statusCode !== 200) {
    return {
      ok: false,
      message: `Health endpoint returned HTTP ${parsed.statusCode} at ${url}.`,
    };
  }

  try {
    JSON.parse(parsed.body) as unknown;
  } catch {
    return {
      ok: false,
      message: `Health endpoint returned non-JSON response at ${url}.`,
    };
  }

  return {
    ok: true,
    message: `Healthy: ${url}`,
  };
}
