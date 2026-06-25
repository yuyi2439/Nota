import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../paths.js";
import {
  openPersonaConfig,
  listPersonas,
  getPersona,
  upsertPersona,
  renamePersona,
  deletePersona,
  setMainSession,
} from "./config-db.js";
import type { PersonaRecord } from "./config-db.js";

export const DEFAULT_PERSONA = "Agent";

export interface PersonaPrompt {
  filename: string;
  content: string;
}

export class PersonaManager {
  private configDb;

  constructor(configPath: string = PATHS.personaConfig) {
    this.configDb = openPersonaConfig(configPath);
  }

  hasAnyPersona(): boolean {
    return this.list().length > 0;
  }

  getSingle(): PersonaRecord | undefined {
    return this.list()[0];
  }

  list(): PersonaRecord[] {
    return listPersonas(this.configDb);
  }

  get(name: string): PersonaRecord | undefined {
    return getPersona(this.configDb, name);
  }

  create(name: string): PersonaRecord {
    if (this.get(name)) throw new Error(`persona already exists: ${name}`);
    const rec: PersonaRecord = {
      name,
      main_session_id: null,
      created_at: new Date().toISOString(),
    };
    upsertPersona(this.configDb, rec);
    mkdirSync(this.workspacePath(name), { recursive: true });
    return rec;
  }

  rename(oldName: string, newName: string): void {
    if (this.get(newName)) throw new Error(`persona already exists: ${newName}`);
    if (!this.get(oldName)) throw new Error(`persona not found: ${oldName}`);
    renamePersona(this.configDb, oldName, newName);
    if (existsSync(this.workspacePath(oldName))) {
      renameSync(this.workspacePath(oldName), this.workspacePath(newName));
    }
  }

  remove(name: string): void {
    deletePersona(this.configDb, name);
  }

  setMainSession(name: string, sessionId: string | null): void {
    setMainSession(this.configDb, name, sessionId);
  }

  workspacePath(name: string): string {
    return join(PATHS.personas, name);
  }

  loadPrompts(name: string): PersonaPrompt[] {
    const dir = this.workspacePath(name);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
    return files.map((filename) => ({
      filename,
      content: readFileSync(join(dir, filename), "utf8"),
    }));
  }

  buildSystemPrompt(name: string): string {
    const prompts = this.loadPrompts(name);
    if (prompts.length === 0) {
      return `You are ${name}.`;
    }
    return prompts
      .map((p) => `# ${p.filename}\n\n${p.content}`)
      .join("\n\n---\n\n");
  }

  close(): void {
    try {
      this.configDb.close();
    } catch {
      // ignore
    }
  }
}
