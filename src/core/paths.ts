import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export const NOTA_HOME = join(homedir(), ".nota");

export const PATHS = {
  home: NOTA_HOME,
  config: join(NOTA_HOME, "config.toml"),
  sessions: join(NOTA_HOME, "sessions"),
  archive: join(NOTA_HOME, "sessions", "archive"),
  personas: join(NOTA_HOME, "personas"),
  personaConfig: join(NOTA_HOME, "personas", "config.sqlite"),
  plugins: join(NOTA_HOME, "plugins"),
} as const;

export function ensureDirs(): void {
  for (const dir of [
    PATHS.home,
    PATHS.sessions,
    PATHS.archive,
    PATHS.personas,
    PATHS.plugins,
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
