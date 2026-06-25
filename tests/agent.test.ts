import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../src/core/session/index.js";
import { PersonaManager } from "../src/core/persona/index.js";
import { AgentRunner } from "../src/core/agent/index.js";
import { ToolRegistryImpl } from "../src/core/tool/index.js";
import { PATHS } from "../src/core/paths.js";
import type { ILlmClient, LlmMessage, LlmStreamEvent, LlmToolDef } from "../src/core/llm/openai/index.js";

let tmpHome: string;
let sessionsDir: string;
let archiveDir: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "nota-agent-"));
  sessionsDir = join(tmpHome, "sessions");
  archiveDir = join(tmpHome, "sessions", "archive");
  (PATHS as { personas: string }).personas = join(tmpHome, "personas");
  (PATHS as { personaConfig: string }).personaConfig = join(
    tmpHome,
    "personas",
    "config.sqlite",
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  rmSync(tmpHome, { recursive: true, force: true });
});

class MockLlm implements ILlmClient {
  constructor(private plan: LlmStreamEvent[][]) {}

  async complete(): Promise<{ message: LlmMessage }> {
    throw new Error("not used");
  }

  async *stream(_messages: LlmMessage[], _tools?: LlmToolDef[]): AsyncIterable<LlmStreamEvent> {
    const step = this.plan.shift();
    if (!step) throw new Error("mock plan exhausted");
    for (const ev of step) yield ev;
  }
}

describe("AgentRunner", () => {
  it("runs a simple turn without tools", async () => {
    const sm = new SessionManager({ sessions: sessionsDir, archive: archiveDir });
    const pm = new PersonaManager();
    pm.create("Bot");
    const { id } = sm.create({ creator: "Bot" });
    sm.appendMessage(id, { role: "user", content: "hi" });

    const mock = new MockLlm([
      [
        { type: "delta", delta: "Hello" },
        { type: "delta", delta: "!" },
        { type: "done", message: { role: "assistant", content: "Hello!" } },
      ],
    ]);
    const tools = new ToolRegistryImpl();
    const runner = new AgentRunner(sm, pm, mock, tools);

    const deltas: string[] = [];
    await runner.runStream(id, "Bot", { onDelta: (d) => deltas.push(d) });

    expect(deltas.join("")).toBe("Hello!");
    const history = sm.history(id);
    expect(history).toHaveLength(2);
    expect(history[1]?.role).toBe("assistant");
    expect(history[1]?.content).toBe("Hello!");
    sm.closeAll();
    pm.close();
  });

  it("runs a tool-call turn", async () => {
    const sm = new SessionManager({ sessions: sessionsDir, archive: archiveDir });
    const pm = new PersonaManager();
    pm.create("Bot");
    const { id } = sm.create({ creator: "Bot" });
    sm.appendMessage(id, { role: "user", content: "what time is it?" });

    const tools = new ToolRegistryImpl();
    tools.register({
      name: "get_time",
      description: "get current time",
      parameters: { type: "object", properties: {} },
      run: async () => "12:00",
    });

    const mock = new MockLlm([
      [
        {
          type: "tool_calls",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } },
          ],
        },
        { type: "done", message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } }] } },
      ],
      [
        { type: "delta", delta: "It is 12:00." },
        { type: "done", message: { role: "assistant", content: "It is 12:00." } },
      ],
    ]);
    const runner = new AgentRunner(sm, pm, mock, tools);

    const results: string[] = [];
    await runner.runStream(id, "Bot", {
      onToolResult: (_id, name, result) => results.push(`${name}:${result}`),
    });

    expect(results).toEqual(["get_time:12:00"]);
    const history = sm.history(id);
    expect(history.filter((m) => m.role === "tool")).toHaveLength(1);
    expect(history.at(-1)?.content).toBe("It is 12:00.");
    sm.closeAll();
    pm.close();
  });

  it("injects workspace prompts as system prompt", async () => {
    const sm = new SessionManager({ sessions: sessionsDir, archive: archiveDir });
    const pm = new PersonaManager();
    pm.create("Coder");
    writeFileSync(join(pm.workspacePath("Coder"), "role.md"), "You are a concise coder.");
    const { id } = sm.create({ creator: "Coder" });
    sm.appendMessage(id, { role: "user", content: "hi" });

    let capturedMessages: LlmMessage[] = [];
    const mock = {
      async complete() { throw new Error("not used"); },
      async *stream(messages: LlmMessage[]): AsyncIterable<LlmStreamEvent> {
        capturedMessages = messages;
        yield { type: "done", message: { role: "assistant", content: "ok" } };
      },
    };
    const runner = new AgentRunner(sm, pm, mock, new ToolRegistryImpl());
    await runner.runStream(id, "Coder");
    expect(capturedMessages[0]?.role).toBe("system");
    expect(capturedMessages[0]?.content).toContain("concise coder");
    sm.closeAll();
    pm.close();
  });
});
