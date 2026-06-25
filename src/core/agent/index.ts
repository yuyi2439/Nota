import type { SessionManager } from "../session/index.js";
import type { PersonaManager } from "../persona/index.js";
import type { ILlmClient, LlmMessage, LlmToolDef, LlmStreamEvent } from "../llm/openai/index.js";
import type { Message } from "../session/types.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolContext {
  personaName: string;
  sessionId: string;
}

export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: unknown, ctx: ToolContext) => Promise<string>;
}

export interface ToolRegistry {
  get: (name: string) => ToolHandler | undefined;
  list: () => ToolHandler[];
  asLlmTools: () => LlmToolDef[];
}

export interface AgentStreamCallbacks {
  onDelta?: (delta: string) => void;
  onToolCalls?: (calls: ToolCall[]) => void;
  onToolResult?: (callId: string, name: string, result: string) => void;
  onMessage?: (message: LlmMessage) => void;
}

export class AgentRunner {
  constructor(
    private sessions: SessionManager,
    private personas: PersonaManager,
    private llm: ILlmClient,
    private tools: ToolRegistry,
  ) {}

  async runStream(
    sessionId: string,
    personaName: string,
    callbacks?: AgentStreamCallbacks,
  ): Promise<void> {
    const persona = this.personas.get(personaName);
    if (!persona) throw new Error(`persona not found: ${personaName}`);

    const systemPrompt = this.personas.buildSystemPrompt(personaName);
    const tools = this.tools.asLlmTools();

    for (let iter = 0; iter < 16; iter++) {
      const history = this.sessions.history(sessionId);
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.map(historyToLlmMessage),
      ];

      let finalMessage: LlmMessage | null = null;
      let toolCalls: ToolCall[] = [];

      for await (const ev of this.llm.stream(messages, tools)) {
        if (ev.type === "delta" && ev.delta) {
          callbacks?.onDelta?.(ev.delta);
        } else if (ev.type === "tool_calls" && ev.tool_calls) {
          toolCalls = ev.tool_calls;
          callbacks?.onToolCalls?.(toolCalls);
        } else if (ev.type === "done" && ev.message) {
          finalMessage = ev.message;
        } else if (ev.type === "error") {
          throw new Error(ev.error ?? "LLM stream error");
        }
      }

      if (!finalMessage) throw new Error("LLM produced no final message");

      this.sessions.appendMessage(sessionId, {
        role: "assistant",
        content: finalMessage.content,
        tool_calls: finalMessage.tool_calls,
      });
      callbacks?.onMessage?.(finalMessage);

      if (!finalMessage.tool_calls || finalMessage.tool_calls.length === 0) {
        return;
      }

      for (const call of finalMessage.tool_calls) {
        const tool = this.tools.get(call.function.name);
        let result: string;
        if (!tool) {
          result = `tool not found: ${call.function.name}`;
        } else {
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            result = await tool.run(args, { personaName, sessionId });
          } catch (err) {
            result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        this.sessions.appendMessage(sessionId, {
          role: "tool",
          content: result,
          tool_call_id: call.id,
        });
        callbacks?.onToolResult?.(call.id, call.function.name, result);
      }
    }

    throw new Error("agent loop exceeded max iterations");
  }
}

function historyToLlmMessage(m: Message): LlmMessage {
  return {
    role: m.role === "tool_call" ? "assistant" : (m.role as LlmMessage["role"]),
    content: m.content,
    tool_calls: m.tool_calls as LlmMessage["tool_calls"],
    tool_call_id: m.tool_call_id,
  };
}
