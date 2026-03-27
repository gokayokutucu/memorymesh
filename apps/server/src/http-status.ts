import type { Request, RequestHandler, Response } from "express";

export interface IHttpStatusPayload {
  name: "memorymesh";
  status: "ok";
  transport: "http";
  mcp_endpoint: "/mcp";
}

export function createHttpStatusPayload(): IHttpStatusPayload {
  return {
    name: "memorymesh",
    status: "ok",
    transport: "http",
    mcp_endpoint: "/mcp",
  };
}

function createHttpStatusHandler(): RequestHandler {
  return (_req: Request, res: Response) => {
    res.status(200).json(createHttpStatusPayload());
  };
}

export function registerHttpStatusRoutes(
  app: Pick<{ get: (path: string, handler: RequestHandler) => void }, "get">
): void {
  const statusHandler = createHttpStatusHandler();
  app.get("/", statusHandler);
  app.get("/health", statusHandler);
}
