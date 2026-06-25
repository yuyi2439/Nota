import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { HOST, PORT } from "../constants.js";
import {
  Router,
  type RouteContext,
  type SSEConnection,
  type WebSocketConnection,
} from "./router.js";
import {
  SubscriptionManager,
  SSEManager,
  type SSEWriter,
} from "./pubsub.js";
import { VERSION } from "../../version.js";

export interface Server {
  router: Router;
  subscriptions: SubscriptionManager;
  sse: SSEManager;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

export function createNotaServer(): Server {
  const router = new Router();
  const subscriptions = new SubscriptionManager();
  const sse = new SSEManager();
  let httpServer: ReturnType<typeof createServer> | null = null;
  let wsServer: WebSocketServer | null = null;
  let running = false;

  const defaultRoutes = new Router();
  defaultRoutes.add("GET", "/health", (ctx) => {
    ctx.send(200, { status: "ok", version: VERSION });
  });

  async function handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const method = (
      req.method ?? "GET"
    ).toUpperCase() as RouteContext["method"];

    let body: unknown = undefined;
    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      body = await readBody(req);
    }

    let sseWriter: SSEWriter | null = null;
    let wsConn: WebSocketConnection | null = null;

    const ctx: RouteContext = {
      method,
      url,
      body,
      headers: normalizeHeaders(req.headers),
      send: (status, data) => {
        if (res.writableEnded) return;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(data === undefined ? "" : JSON.stringify(data));
      },
      sse: () => {
        if (sseWriter) return sseToConnection(sseWriter);
        if (res.writableEnded) return null;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sseWriter = {
          write: (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(
              `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
            );
          },
          close: () => {
            if (!res.writableEnded) res.end();
          },
          onClose: (h) => {
            req.on("close", h);
          },
        };
        return sseToConnection(sseWriter);
      },
      ws: () => wsConn,
    };

    const handled = await router.dispatch(ctx);
    if (!handled) {
      const fallback = await defaultRoutes.dispatch(ctx);
      if (!fallback) {
        ctx.send(404, { error: "not found", path: url.pathname });
      }
    }
  }

  function handleWs(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    const sessionId = url.searchParams.get("session");
    const connection: WebSocketConnection = {
      send: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
      },
      close: () => ws.close(),
      onMessage: (handler) => {
        ws.on("message", (raw) => {
          try {
            handler(JSON.parse(raw.toString()));
          } catch {
            handler(raw.toString());
          }
        });
      },
      onClose: (handler) => ws.on("close", handler),
    };

    if (sessionId) {
      const ok = subscriptions.subscribe(sessionId, connection);
      if (!ok) {
        connection.send({
          event: "error",
          data: { message: "session already subscribed" },
        });
        connection.close();
        return;
      }
      connection.send({ event: "subscribed", data: { sessionId } });
    }
  }

  return {
    router,
    subscriptions,
    sse,
    start: () =>
      new Promise<void>((resolve, reject) => {
        if (running) return resolve();
        try {
          httpServer = createServer(handleHttp);
          wsServer = new WebSocketServer({ server: httpServer });
          wsServer.on("connection", handleWs);
          httpServer.on("error", reject);
          httpServer.listen(PORT, HOST, () => {
            running = true;
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        if (!httpServer) return resolve();
        wsServer?.close();
        httpServer.close(() => {
          running = false;
          httpServer = null;
          wsServer = null;
          resolve();
        });
      }),
    isRunning: () => running,
  };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
    req.on("error", reject);
  });
}

function normalizeHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = Array.isArray(v) ? v.join(",") : v;
  }
  return out;
}

function sseToConnection(writer: SSEWriter): SSEConnection {
  return {
    send: (event, data) => writer.write(event, data),
    close: () => writer.close(),
  };
}
