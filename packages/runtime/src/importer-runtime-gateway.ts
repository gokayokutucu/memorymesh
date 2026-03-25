import {
  ICancellationToken,
  IImporterGateway,
  ImportInterruptedError,
  ISaveMemoryInput,
  ISearchResult,
} from "@memorymesh/core";
import {
  getMemoryByRef,
  getMemoryStatus,
  saveMemoryForImport,
} from "./memory";

const SAVE_STATUS_POLL_INTERVAL_MS = 25;
const SAVE_STATUS_TIMEOUT_MS = Number.parseInt(
  process.env.MEMORYMESH_IMPORT_SAVE_STATUS_TIMEOUT_MS ?? "15000",
  10
);

export class RuntimeImporterGateway implements IImporterGateway {
  constructor(private readonly cancellationToken?: ICancellationToken) {}

  async saveMemory(input: ISaveMemoryInput): Promise<void> {
    const result = saveMemoryForImport(input, {
      cancellationToken: this.cancellationToken,
    });
    if (result.status === "failed") {
      throw toImportSaveError(result.error_code, result.payload_bytes, result.max_payload_bytes);
    }
    if (result.status === "skipped") {
      throw toImportSaveError(result.reason ?? result.error_code ?? "save_skipped");
    }
    if (result.status === "partial") {
      throw toImportSaveError("partial_persistence");
    }

    const status = await waitForFinalSaveStatus(result.id);
    if (!status || status.status === "pending") {
      throw toImportSaveError("save_status_pending_timeout");
    }
    if (status.status === "failed") {
      throw toImportSaveError(
        status.error_code ?? "save_failed",
        status.payload_bytes,
        status.max_payload_bytes
      );
    }
    if (status.status === "partial") {
      throw toImportSaveError("partial_persistence");
    }
  }

  async getMemoryByRef(
    refId: string,
    project?: string
  ): Promise<ISearchResult[]> {
    return getMemoryByRef({
      ref_id: refId,
      project,
    });
  }
}

export function createRuntimeImporterGateway(
  cancellationToken?: ICancellationToken
): IImporterGateway {
  return new RuntimeImporterGateway(cancellationToken);
}

async function waitForFinalSaveStatus(
  id: string
): Promise<ReturnType<typeof getMemoryStatus>> {
  const timeoutMs = Number.isNaN(SAVE_STATUS_TIMEOUT_MS)
    ? 15000
    : SAVE_STATUS_TIMEOUT_MS;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const status = getMemoryStatus(id);
    if (!status || status.status !== "pending") {
      return status;
    }
    await sleep(SAVE_STATUS_POLL_INTERVAL_MS);
  }
  return getMemoryStatus(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toImportSaveError(
  code: string | undefined,
  payloadBytes?: number,
  maxPayloadBytes?: number
): Error {
  if (code === "import_interrupted") {
    return new ImportInterruptedError();
  }
  const error = new Error(code ?? "save_failed") as Error & {
    code?: string;
    payload_bytes?: number;
    max_payload_bytes?: number;
  };
  error.code = code ?? "save_failed";
  error.payload_bytes = payloadBytes;
  error.max_payload_bytes = maxPayloadBytes;
  return error;
}
