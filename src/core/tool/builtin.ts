import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolHandler, ToolContext } from "../agent/index.js";
import type { PersonaManager } from "../persona/index.js";
import type { SessionManager } from "../session/index.js";
import { PATHS } from "../paths.js";

function workspaceRoot(personaName: string): string {
  return resolve(join(PATHS.personas, personaName));
}

function assertWithinWorkspace(personaName: string, target: string): string {
  const root = workspaceRoot(personaName);
  const full = resolve(join(root, normalize(target)));
  const rel = full.slice(root.length);
  if (rel !== "" && !rel.startsWith(sep) && !rel.startsWith("/") && full !== root) {
    // resolved outside
  }
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error("access denied: path outside workspace");
  }
  return full;
}

export function createFileReadTool(personas: PersonaManager): ToolHandler {
  return {
    name: "file_read",
    description:
      "Read the content of a file inside your own workspace. Path is relative to your workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "relative path within your workspace" },
      },
      required: ["path"],
    },
    run: async (args, ctx: ToolContext) => {
      const { path } = args as { path?: string };
      if (!path) return "error: path required";
      const full = assertWithinWorkspace(ctx.personaName, path);
      if (!existsSync(full)) return `error: file not found: ${path}`;
      return readFileSync(full, "utf8");
    },
  };
}

export function createFileWriteTool(personas: PersonaManager): ToolHandler {
  return {
    name: "file_write",
    description:
      "Write content to a file inside your own workspace. Path is relative to your workspace root. Creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "relative path within your workspace" },
        content: { type: "string", description: "content to write" },
        append: { type: "boolean", description: "append instead of overwrite" },
      },
      required: ["path", "content"],
    },
    run: async (args, ctx: ToolContext) => {
      const { path, content, append } = args as {
        path?: string;
        content?: string;
        append?: boolean;
      };
      if (!path) return "error: path required";
      if (content === undefined) return "error: content required";
      const full = assertWithinWorkspace(ctx.personaName, path);
      mkdirSync(full.slice(0, full.lastIndexOf(sep)), { recursive: true });
      if (append && existsSync(full)) {
        writeFileSync(full, readFileSync(full, "utf8") + content);
      } else {
        writeFileSync(full, content);
      }
      return `ok: wrote ${content.length} chars to ${path}`;
    },
  };
}

export function createScheduleTool(sessions: SessionManager): ToolHandler {
  return {
    name: "schedule",
    description:
      "Schedule a message to be pushed into the current session at a future time. Useful for reminders or deferred self-prompts.",
    parameters: {
      type: "object",
      properties: {
        trigger_at: {
          type: "string",
          description: "ISO 8601 datetime when the message should be pushed",
        },
        content: { type: "string", description: "message content to push" },
      },
      required: ["trigger_at", "content"],
    },
    run: async (args, ctx: ToolContext) => {
      const { trigger_at, content } = args as {
        trigger_at?: string;
        content?: string;
      };
      if (!trigger_at) return "error: trigger_at required";
      if (!content) return "error: content required";
      const when = Date.parse(trigger_at);
      if (Number.isNaN(when)) return "error: invalid trigger_at datetime";

      const entry = sessions.open(ctx.sessionId);
      entry.db
        .prepare(
          "INSERT INTO schedules (id, trigger_at, content, status) VALUES (?, ?, ?, ?)",
        )
        .run(randomUUID(), trigger_at, content, "pending");
      return `ok: scheduled for ${trigger_at}`;
    },
  };
}

export function registerBuiltinTools(
  registry: { register: (t: ToolHandler) => void },
  personas: PersonaManager,
  sessions: SessionManager,
): void {
  registry.register(createFileReadTool(personas));
  registry.register(createFileWriteTool(personas));
  registry.register(createScheduleTool(sessions));
}
