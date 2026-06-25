export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContext {
  method: HttpMethod;
  url: URL;
  body: unknown;
  headers: Record<string, string | undefined>;
  send: (status: number, data?: unknown) => void;
  sse: () => SSEConnection | null;
  ws: () => WebSocketConnection | null;
}

export interface SSEConnection {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

export interface WebSocketConnection {
  send: (data: unknown) => void;
  close: () => void;
  onMessage: (handler: (data: unknown) => void) => void;
  onClose: (handler: () => void) => void;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

interface Route {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  add(method: HttpMethod, path: string, handler: RouteHandler): void {
    // little :param support
    const paramNames: string[] = [];
    const patternStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });

    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  async dispatch(ctx: RouteContext): Promise<boolean> {
    const pathname = ctx.url.pathname;
    for (const route of this.routes) {
      if (route.method !== ctx.method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      await route.handler(ctx);
      return true;
    }
    return false;
  }
}
