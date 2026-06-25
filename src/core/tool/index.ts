import type { LlmToolDef } from "../llm/openai/index.js";
import type { ToolHandler, ToolRegistry } from "../agent/index.js";

export class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  list(): ToolHandler[] {
    return [...this.tools.values()];
  }

  asLlmTools(): LlmToolDef[] {
    return this.list().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}

export type { ToolHandler, ToolRegistry } from "../agent/index.js";
export { registerBuiltinTools } from "./builtin.js";
