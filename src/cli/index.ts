import { Command } from "commander";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ensureDirs } from "../core/paths.js";
import { HOST, PORT } from "../core/constants.js";
import { createNotaServer } from "../core/server/index.js";
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
  .action((action: string, id?: string) => {
    ensureDirs();
    console.log(`[session] action=${action} id=${id ?? "-"}`);
    console.log("[session] not yet implemented (M2).");
  });

program
  .command("chat")
  .description("One-shot chat (SSE streaming by default).")
  .option("--session <id>", "continue an existing session")
  .option("--persona <id>", "persona to talk to", "Agent")
  .option("--no-stream", "disable streaming (for scripting)")
  .action((opts: { session?: string; persona: string; stream: boolean }) => {
    ensureDirs();
    console.log(
      `[chat] persona=${opts.persona} session=${opts.session ?? "-"} stream=${opts.stream}`,
    );
    console.log("[chat] not yet implemented (M6/M11).");
  });

program
  .command("plugins")
  .description("Manage plugins.")
  .argument("<action>", "list | tools | reload")
  .argument("[name]", "plugin name (for reload)")
  .action((action: string, name?: string) => {
    ensureDirs();
    console.log(`[plugins] action=${action} name=${name ?? "-"}`);
    console.log("[plugins] not yet implemented (M9).");
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
