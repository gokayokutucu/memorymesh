import type { RequestHandler } from "express";
import {
  createHttpStatusPayload,
  registerHttpStatusRoutes,
} from "../http-status";

interface IRecordedResponse {
  code: number;
  payload: unknown;
}

interface IFakeResponse {
  status(code: number): IFakeResponse;
  json(payload: unknown): IFakeResponse;
}

describe("http status routes", () => {
  it("returns stable status payload", () => {
    expect(createHttpStatusPayload()).toEqual({
      name: "memorymesh",
      status: "ok",
      transport: "http",
      mcp_endpoint: "/mcp",
    });
  });

  it("registers both root and health routes with identical 200 JSON", () => {
    const handlers = new Map<string, RequestHandler>();
    registerHttpStatusRoutes({
      get(path: string, handler: RequestHandler): void {
        handlers.set(path, handler);
      },
    });

    expect(handlers.has("/")).toBe(true);
    expect(handlers.has("/health")).toBe(true);

    const rootResult = invokeRoute(handlers.get("/") ?? null);
    const healthResult = invokeRoute(handlers.get("/health") ?? null);

    expect(rootResult.code).toBe(200);
    expect(healthResult.code).toBe(200);
    expect(rootResult.payload).toEqual(createHttpStatusPayload());
    expect(healthResult.payload).toEqual(createHttpStatusPayload());
  });
});

function invokeRoute(handler: RequestHandler | null): IRecordedResponse {
  if (!handler) {
    throw new Error("Missing route handler");
  }

  const result: IRecordedResponse = { code: 0, payload: null };
  const response: IFakeResponse = {
    status(code: number): IFakeResponse {
      result.code = code;
      return response;
    },
    json(payload: unknown): IFakeResponse {
      result.payload = payload;
      return response;
    },
  };

  handler({} as Parameters<RequestHandler>[0], response as Parameters<RequestHandler>[1], () => {
    throw new Error("next() should not be called");
  });

  return result;
}
