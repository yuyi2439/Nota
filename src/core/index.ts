import { randomUUID } from "node:crypto";
import { SessionManager } from "./session/index.js";
import { PersonaManager } from "./persona/index.js";
import { ToolRegistryImpl, registerBuiltinTools } from "./tool/index.js";
import { AgentRunner } from "./agent/index.js";
import { LlmClient } from "./llm/openai/index.js";
import type { ILlmClient } from "./llm/openai/index.js";
import type { Server } from "./server/index.js";
import type { SubscriptionManager } from "./server/pubsub.js";
import type { Participant, CreateSessionOptions } from "./session/types.js";

export interface CoreDeps {
  sessions: SessionManager;
  personas: PersonaManager;
  tools: ToolRegistryImpl;
  llm: ILlmClient;
  agent: AgentRunner;
  server: Server;
}

export function buildCoreDeps(server: Server): CoreDeps {
  const sessions = new SessionManager();
  const personas = new PersonaManager();
  const tools = new ToolRegistryImpl();
  registerBuiltinTools(tools, personas, sessions);
  const llm = new LlmClient({
    apiKey: process.env["NOTA_OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"],
    baseURL: process.env["NOTA_OPENAI_BASE_URL"] ?? process.env["OPENAI_BASE_URL"],
    model: process.env["NOTA_MODEL"] ?? "gpt-4o-mini",
  });
  const agent = new AgentRunner(sessions, personas, llm, tools);
  return { sessions, personas, tools, llm, agent, server };
}

export interface Core extends CoreDeps {
  subscriptions: SubscriptionManager;
  createSession: (opts: CreateSessionOptions) => { id: string };
  listSessions: () => ReturnType<SessionManager["list"]>;
  getSession: (id: string) => { meta: ReturnType<SessionManager["meta"]>; messages: ReturnType<SessionManager["history"]> };
  postMessage: (sessionId: string, content: string) => Promise<void>;
  attachRoutes: () => void;
}

export function createCore(server: Server): Core {
  const deps = buildCoreDeps(server);
  const { sessions, personas, agent, server: srv } = deps;
  const subscriptions = srv.subscriptions;

  function push(sessionId: string, event: string, data: unknown): void {
    subscriptions.push(sessionId, event, data);
  }

  const core: Core = {
    ...deps,
    subscriptions,
    createSession: (opts) => {
      const meta = sessions.create(opts);
      return { id: meta.id };
    },
    listSessions: () => sessions.list(),
    getSession: (id) => ({
      meta: sessions.meta(id),
      messages: sessions.history(id),
    }),
    postMessage: async (sessionId, content) => {
      const persona = personas.getSingle();
      if (!persona) throw new Error("no persona initialized; run `nota daemon run` first");
      const personaName = persona.name;
      sessions.appendMessage(sessionId, { role: "user", content });
      push(sessionId, "user_message", { content });
      await agent.runStream(sessionId, personaName, {
        onDelta: (delta) => push(sessionId, "delta", { delta }),
        onToolCalls: (calls) => push(sessionId, "tool_calls", { calls }),
        onToolResult: (callId, name, result) =>
          push(sessionId, "tool_result", { callId, name, result }),
        onMessage: (message) => push(sessionId, "assistant_message", { message }),
      });
    },
    attachRoutes: () => {
      const r = srv.router;
      r.add("POST", "/session", (ctx) => {
        const body = ctx.body as {
          creator?: string;
          participants?: Participant[];
        } | null;
        const persona = personas.getSingle();
        const creator = body?.creator ?? persona?.name ?? "cli";
        const meta = sessions.create({
          creator,
          participants: body?.participants,
        });
        if (persona) {
          personas.setMainSession(persona.name, meta.id);
        }
        ctx.send(201, meta);
      });
      r.add("GET", "/session", (ctx) => {
        ctx.send(200, sessions.list());
      });
      r.add("GET", "/session/:id", (ctx) => {
        const id = ctx.url.pathname.split("/").pop()!;
        if (!sessions.exists(id) && !sessions.isArchived(id)) {
          ctx.send(404, { error: "session not found" });
          return;
        }
        ctx.send(200, {
          meta: sessions.meta(id),
          messages: sessions.history(id),
        });
      });
      r.add("POST", "/session/:id/messages", async (ctx) => {
        const id = ctx.url.pathname.split("/")[2]!;
        const body = ctx.body as { content?: string } | null;
        if (!body?.content) {
          ctx.send(400, { error: "content required" });
          return;
        }
        if (!personas.getSingle()) {
          ctx.send(409, { error: "no persona initialized" });
          return;
        }
        if (!subscriptions.isSubscribed(id)) {
          ctx.send(409, { error: "session not subscribed; connect WS first" });
          return;
        }
        ctx.send(202, { status: "accepted" });
        void core.postMessage(id, body.content).catch((err) => {
          push(id, "error", { message: String(err) });
        });
      });
      r.add("POST", "/session/:id/archive", (ctx) => {
        const id = ctx.url.pathname.split("/")[2]!;
        try {
          sessions.archive(id);
          ctx.send(200, { status: "archived", id });
        } catch (err) {
          ctx.send(404, { error: String(err) });
        }
      });
      r.add("POST", "/session/:id/restore", (ctx) => {
        const id = ctx.url.pathname.split("/")[2]!;
        try {
          sessions.restore(id);
          ctx.send(200, { status: "restored", id });
        } catch (err) {
          ctx.send(404, { error: String(err) });
        }
      });
    },
  };

  return core;
}
