import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions.js";

export interface LlmConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface LlmToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmStreamEvent {
  type: "delta" | "tool_calls" | "done" | "error";
  delta?: string;
  tool_calls?: LlmMessage["tool_calls"];
  message?: LlmMessage;
  error?: string;
}

export interface LlmCompletion {
  message: LlmMessage;
}

export interface ILlmClient {
  complete(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmCompletion>;
  stream(messages: LlmMessage[], tools?: LlmToolDef[]): AsyncIterable<LlmStreamEvent>;
}

export class LlmClient implements ILlmClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model;
  }

  async complete(
    messages: LlmMessage[],
    tools?: LlmToolDef[],
  ): Promise<LlmCompletion> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as ChatCompletionMessageParam[],
      tools: tools as ChatCompletionTool[] | undefined,
    });
    const choice = res.choices[0];
    if (!choice) throw new Error("LLM returned no choices");
    return { message: toLlmMessage(choice.message) };
  }

  async *stream(
    messages: LlmMessage[],
    tools?: LlmToolDef[],
  ): AsyncIterable<LlmStreamEvent> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as ChatCompletionMessageParam[],
      tools: tools as ChatCompletionTool[] | undefined,
      stream: true,
    });

    const toolCallAcc: Record<
      number,
      { id: string; type: "function"; function: { name: string; arguments: string } }
    > = {};
    let contentBuf = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        contentBuf += delta.content;
        yield { type: "delta", delta: delta.content };
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAcc[idx]) {
            toolCallAcc[idx] = {
              id: tc.id ?? "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) toolCallAcc[idx]!.id = tc.id;
          if (tc.function?.name) toolCallAcc[idx]!.function.name += tc.function.name;
          if (tc.function?.arguments)
            toolCallAcc[idx]!.function.arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallAcc).sort(
      (a, b) => 0,
    );
    if (toolCalls.length > 0) {
      yield { type: "tool_calls", tool_calls: toolCalls };
    }

    const message: LlmMessage = {
      role: "assistant",
      content: contentBuf,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    yield { type: "done", message };
  }
}

function toLlmMessage(m: {
  role: string;
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}): LlmMessage {
  return {
    role: m.role as LlmMessage["role"],
    content: m.content ?? "",
    tool_calls: m.tool_calls as LlmMessage["tool_calls"],
    tool_call_id: m.tool_call_id,
  };
}
