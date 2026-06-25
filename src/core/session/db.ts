import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Message,
  MessageRole,
  Participant,
  Schedule,
  SessionMeta,
} from "./types.js";

export interface SessionDb {
  db: DB;
  meta: SessionMeta;
  close: () => void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  type TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  trigger_at TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_trigger ON schedules(trigger_at);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);
`;

const META_KEYS = [
  "id",
  "creator",
  "created_at",
  "archive_at",
  "archived_at",
  "classification",
] as const;

export function openSessionDb(
  path: string,
  meta: SessionMeta,
): SessionDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  for (const key of META_KEYS) {
    const value = meta[key];
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
    ).run(key, value === null ? "" : String(value));
  }
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  ).run("participants", JSON.stringify(meta.participants));

  return {
    db,
    meta,
    close: () => db.close(),
  };
}

export function readSessionMeta(db: DB): SessionMeta {
  const rows = db
    .prepare("SELECT key, value FROM meta")
    .all() as { key: string; value: string }[];

  const map = new Map<string, string>();
  for (const row of rows) map.set(row.key, row.value);

  const participants: Participant[] = (() => {
    try {
      return JSON.parse(map.get("participants") ?? "[]");
    } catch {
      return [];
    }
  })();

  return {
    id: map.get("id") ?? "",
    creator: map.get("creator") ?? "",
    participants,
    created_at: map.get("created_at") ?? "",
    archive_at: map.get("archive_at") || null,
    archived_at: map.get("archived_at") || null,
    classification: map.get("classification") || null,
  };
}

export function insertMessage(
  db: DB,
  msg: Message,
): void {
  db.prepare(
    `INSERT INTO messages (id, role, content, tool_calls, tool_call_id, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.role,
    msg.content,
    msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    msg.tool_call_id ?? null,
    msg.type ?? null,
    msg.created_at,
  );
}

export function listMessages(
  db: DB,
  limit?: number,
): Message[] {
  const sql = limit
    ? "SELECT * FROM messages ORDER BY created_at ASC LIMIT ?"
    : "SELECT * FROM messages ORDER BY created_at ASC";
  const rows = db.prepare(sql).all(...(limit ? [limit] : [])) as Row[];
  return rows.map(rowToMessage);
}

export function insertSchedule(db: DB, s: Schedule): void {
  db.prepare(
    `INSERT INTO schedules (id, trigger_at, content, status)
     VALUES (?, ?, ?, ?)`,
  ).run(s.id, s.trigger_at, s.content, s.status);
}

export function listPendingSchedules(db: DB): Schedule[] {
  const rows = db
    .prepare("SELECT * FROM schedules WHERE status = 'pending' ORDER BY trigger_at ASC")
    .all() as ScheduleRow[];
  return rows.map(rowToSchedule);
}

export function updateScheduleStatus(
  db: DB,
  id: string,
  status: Schedule["status"],
): void {
  db.prepare("UPDATE schedules SET status = ? WHERE id = ?").run(status, id);
}

interface Row {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  type: string | null;
  created_at: string;
}

interface ScheduleRow {
  id: string;
  trigger_at: string;
  content: string;
  status: string;
}

function rowToMessage(r: Row): Message {
  return {
    id: r.id,
    role: r.role as MessageRole,
    content: r.content,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
    tool_call_id: r.tool_call_id ?? undefined,
    type: r.type ?? undefined,
    created_at: r.created_at,
  };
}

function rowToSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    trigger_at: r.trigger_at,
    content: r.content,
    status: r.status as Schedule["status"],
  };
}
