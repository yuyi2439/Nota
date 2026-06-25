import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS personas (
  name TEXT PRIMARY KEY,
  main_session_id TEXT,
  created_at TEXT NOT NULL
);
`;

export interface PersonaRecord {
  name: string;
  main_session_id: string | null;
  created_at: string;
}

export function openPersonaConfig(path: string): DB {
  mkdirSync(path.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function listPersonas(db: DB): PersonaRecord[] {
  return db
    .prepare("SELECT name, main_session_id, created_at FROM personas ORDER BY name")
    .all() as PersonaRecord[];
}

export function getPersona(db: DB, name: string): PersonaRecord | undefined {
  return db
    .prepare("SELECT name, main_session_id, created_at FROM personas WHERE name = ?")
    .get(name) as PersonaRecord | undefined;
}

export function upsertPersona(db: DB, rec: PersonaRecord): void {
  db.prepare(
    `INSERT INTO personas (name, main_session_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET main_session_id = excluded.main_session_id`,
  ).run(rec.name, rec.main_session_id, rec.created_at);
}

export function renamePersona(db: DB, oldName: string, newName: string): void {
  db.prepare("UPDATE personas SET name = ? WHERE name = ?").run(newName, oldName);
}

export function deletePersona(db: DB, name: string): void {
  db.prepare("DELETE FROM personas WHERE name = ?").run(name);
}

export function setMainSession(db: DB, name: string, sessionId: string | null): void {
  db.prepare("UPDATE personas SET main_session_id = ? WHERE name = ?").run(
    sessionId,
    name,
  );
}
