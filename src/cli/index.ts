import { Command } from "commander";
import { ensureDirs } from "../core/paths.js";

const program = new Command();

program
  .name("nota")
  .description("A persona-centric AI agent framework.")
  .version("0.1.0");

program
  .command("daemon")
  .description("Manage the core daemon.")
  .argument("<action>", "start | stop | status")
  .option("--foreground", "run in foreground (only for start)")
  .action((action: string, opts: { foreground?: boolean }) => {
    ensureDirs();
    console.log(`[daemon] action=${action} foreground=${opts.foreground ?? false}`);
    console.log("[daemon] not yet implemented (M1).");
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

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
