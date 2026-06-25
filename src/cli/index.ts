import { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ensureDirs } from "../core/paths.js";
import { HOST, PORT } from "../core/constants.js";
import { createNotaServer } from "../core/server/index.js";
import { createCore } from "../core/index.js";
import { PersonaManager } from "../core/persona/index.js";
import { VERSION } from "../version.js";

const program = new Command();

program
  .name("nota")
  .description("A persona-centric AI agent framework.")
  .version(VERSION);

program
  .command("daemon")
  .description("Manage the core daemon.")
  .argument("<action>", "status | run | start | stop") // TODO: describe this
  .action(async (action: string) => {
    ensureDirs();
    if (action === "status") {
      await statusDaemon();
    } else if (action === "run") {
      await runDaemon();
    } else if (action === "start") {
      await startDaemon();
    } else if (action === "stop") {
      await stopDaemon();
    } else {
      console.error(`[daemon] unknown action: ${action}`);
      process.exit(1);
    }
  });

program
  .command("session")
  .description("Manage sessions.")
  .argument("<action>", "list | show | archive | restore")
  .argument("[id]", "session id")
  .action(async (action: string, id?: string) => {
    ensureDirs();
    const base = `http://${HOST}:${PORT}`;
    try {
      if (action === "list") {
        const res = await fetch(`${base}/session`);
        const data = (await res.json()) as Array<{
          id: string;
          creator: string;
          archived: boolean;
          created_at: string;
        }>;
        if (data.length === 0) {
          console.log("[session] no sessions");
          return;
        }
        for (const s of data) {
          const tag = s.archived ? "[archived]" : "[active]";
          console.log(`${tag} ${s.id}  creator=${s.creator}  ${s.created_at}`);
        }
      } else if (action === "show") {
        if (!id) {
          console.error("[session] show requires an id");
          process.exit(1);
        }
        const res = await fetch(`${base}/session/${id}`);
        if (!res.ok) {
          console.error(`[session] ${res.status} ${await res.text()}`);
          process.exit(1);
        }
        const data = (await res.json()) as {
          meta: { creator: string; created_at: string };
          messages: Array<{ role: string; content: string; created_at: string }>;
        };
        console.log(`session ${id}  creator=${data.meta.creator}`);
        for (const m of data.messages) {
          console.log(`\n[${m.role}] ${m.created_at}`);
          console.log(m.content);
        }
      } else if (action === "archive") {
        if (!id) {
          console.error("[session] archive requires an id");
          process.exit(1);
        }
        const res = await fetch(`${base}/session/${id}/archive`, {
          method: "POST",
        });
        if (!res.ok) {
          console.error(`[session] ${res.status} ${await res.text()}`);
          process.exit(1);
        }
        console.log(`[session] archived ${id}`);
      } else if (action === "restore") {
        if (!id) {
          console.error("[session] restore requires an id");
          process.exit(1);
        }
        const res = await fetch(`${base}/session/${id}/restore`, {
          method: "POST",
        });
        if (!res.ok) {
          console.error(`[session] ${res.status} ${await res.text()}`);
          process.exit(1);
        }
        console.log(`[session] restored ${id}`);
      } else {
        console.error(`[session] unknown action: ${action}`);
        process.exit(1);
      }
    } catch (err) {
      console.error("[session] error:", err);
      process.exit(1);
    }
  });

program
  .command("chat")
  .description("Send one message (streaming via WS).")
  .option("--session <id>", "continue an existing session")
  .option("--no-stream", "disable streaming (for scripting)")
  .action(async (opts: { session?: string; stream: boolean }) => {
    ensureDirs();
    const base = `http://${HOST}:${PORT}`;
    const wsBase = `ws://${HOST}:${PORT}`;
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    const content = await rl.question("");
    rl.close();
    if (!content) {
      console.error("[chat] no input");
      process.exit(1);
    }
    let sessionId = opts.session;
    try {
      if (!sessionId) {
        const res = await fetch(`${base}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creator: "cli" }),
        });
        if (!res.ok) {
          console.error(`[chat] create session failed: ${res.status} ${await res.text()}`);
          process.exit(1);
        }
        const meta = (await res.json()) as { id: string };
        sessionId = meta.id;
        console.error(`[chat] new session ${sessionId}`);
      }
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`${wsBase}/?session=${sessionId}`);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        ws.close();
      };
      ws.on("open", () => {
        void fetch(`${base}/session/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }).catch((err) => {
          console.error("[chat] post message failed:", err);
          finish();
        });
      });
      ws.on("message", (raw) => {
        const data = JSON.parse(raw.toString()) as { event: string; data: unknown };
        if (data.event === "delta" && opts.stream) {
          const d = data.data as { delta: string };
          process.stdout.write(d.delta);
        } else if (data.event === "assistant_message") {
          if (!opts.stream) {
            const d = data.data as { message: { content: string } };
            process.stdout.write(d.message.content);
          }
        } else if (data.event === "error") {
          const d = data.data as { message: string };
          console.error("[chat] error:", d.message);
          finish();
        }
      });
      ws.on("close", () => {
        if (!opts.stream) process.stdout.write("\n");
        else process.stdout.write("\n");
        console.error(`[chat] session ${sessionId}`);
      });
    } catch (err) {
      console.error("[chat] error:", err);
      process.exit(1);
    }
  });

program
  .command("tui")
  .description("Start the TUI (ink) interface.")
  .option("--session <id>", "continue an existing session")
  .action(async (opts: { session?: string }) => {
    ensureDirs();
    const { runTui } = await import("../tui/index.js");
    await runTui({ sessionId: opts.session });
  });

/**
 * Return exit code 0 regardless of whether daemon is running
 */
async function statusDaemon(): Promise<void> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/health`);
    if (res.ok) {
      const data = await res.json();
      console.log(`[daemon] running — ${JSON.stringify(data)}`);
    } else {
      console.error(`[daemon] not healthy: HTTP ${res.status}`);
    }
  } catch {
    console.error(`[daemon] not running (no response at ${HOST}:${PORT})`);
  }
}

async function runDaemon(): Promise<void> {
  const server = createNotaServer();
  const core = createCore(server);
  await ensurePersonaInitialized();
  core.attachRoutes();
  server.router.add("POST", "/admin/shutdown", (ctx) => {
    ctx.send(200, { message: "shutting down" });
    setTimeout(() => {
      void server.stop().then(() => process.exit(0));
    }, 100);
  });
  try {
    await server.start();
    console.log(`[daemon] listening on http://${HOST}:${PORT}`);
    process.on("SIGINT", () => {
      void server.stop().then(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void server.stop().then(() => process.exit(0));
    });
  } catch (err) {
    console.error("[daemon] failed to start:", err);
    process.exit(1);
  }
}

async function ensurePersonaInitialized(): Promise<void> {
  const personas = new PersonaManager();
  if (personas.hasAnyPersona()) {
    personas.close();
    return;
  }
  const readline = await import("node:readline/promises");
  const { stdin, stdout } = process;
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  console.log("Welcome to Nota. Let's create your persona.");
  const name = (await rl.question("Persona name: ")).trim();
  rl.close();
  if (!name) {
    console.error("[init] persona name cannot be empty");
    process.exit(1);
  }
  personas.create(name);
  personas.close();
  console.log(`[init] persona "${name}" created.`);
}

async function startDaemon(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const isDev = !__dirname.includes("dist");
  const entry = isDev
    ? join(__dirname, "index.ts")
    : join(__dirname, "index.js");

  //! 若args给错，nota daemon start正常结束，不会有任何报错
  //! Check this seriously
  const args = isDev
    ? ["--import", "tsx", entry, "daemon", "run"]
    : [entry, "daemon", "run"];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  child.unref();
  console.log(`[daemon] started in background (pid ${child.pid})`);
}

async function stopDaemon(): Promise<void> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/admin/shutdown`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[daemon] stopping - ${JSON.stringify(data)}`);
    } else {
      console.error(`[daemon] stop failed: HTTP ${res.status}`);
      process.exit(1);
    }
  } catch (err) {
    // TODO: 稍微包装一下报错
    console.error("[daemon] cannot reach daemon:", err);
    process.exit(1);
  }
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
