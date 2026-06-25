import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PATHS } from "../paths.js";
import { ARCHIVE_TIMEOUT_DAYS } from "../constants.js";
import {
  openSessionDb,
  readSessionMeta,
  insertMessage,
  listMessages,
} from "./db.js";
import type { SessionDb } from "./db.js";
import type {
  CreateSessionOptions,
  Message,
  SessionInfo,
  SessionMeta,
} from "./types.js";

export interface SessionManagerPaths {
  sessions: string;
  archive: string;
}

const SEP = "-";

export class SessionManager {
  private openDbs = new Map<string, SessionDb>();
  private paths: SessionManagerPaths;

  constructor(paths: SessionManagerPaths = { sessions: PATHS.sessions, archive: PATHS.archive }) {
    this.paths = paths;
    mkdirSync(paths.sessions, { recursive: true });
    mkdirSync(paths.archive, { recursive: true });
  }

  create(opts: CreateSessionOptions): SessionMeta {
    const id = randomUUID();
    const now = new Date().toISOString();
    const archiveAt =
      opts.archiveAfterDays === null || opts.archiveAfterDays === undefined
        ? new Date(Date.now() + ARCHIVE_TIMEOUT_DAYS * 86400000).toISOString()
        : null;
    const meta: SessionMeta = {
      id,
      creator: opts.creator,
      participants: opts.participants ?? [],
      created_at: now,
      archive_at: archiveAt,
      archived_at: null,
      classification: opts.classification ?? null,
    };
    const path = this.pathFor(id);
    const entry = openSessionDb(path, meta);
    this.openDbs.set(id, entry);
    return meta;
  }

  open(id: string): SessionDb {
    const cached = this.openDbs.get(id);
    if (cached) return cached;
    const path = this.pathFor(id);
    if (!existsSync(path)) throw new Error(`session not found: ${id}`);
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    const meta = readSessionMeta(db);
    const entry: SessionDb = { db, meta, close: () => db.close() };
    this.openDbs.set(id, entry);
    return entry;
  }

  close(id: string): void {
    const entry = this.openDbs.get(id);
    if (!entry) return;
    entry.close();
    this.openDbs.delete(id);
  }

  closeAll(): void {
    for (const [, entry] of this.openDbs) entry.close();
    this.openDbs.clear();
  }

  appendMessage(id: string, msg: Omit<Message, "id" | "created_at">): Message {
    const entry = this.open(id);
    const full: Message = {
      ...msg,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    insertMessage(entry.db, full);
    return full;
  }

  history(id: string, limit?: number): Message[] {
    return listMessages(this.open(id).db, limit);
  }

  meta(id: string): SessionMeta {
    return this.open(id).meta;
  }

  list(): SessionInfo[] {
    const out: SessionInfo[] = [];
    for (const dir of [this.paths.sessions, this.paths.archive]) {
      const archived = dir === this.paths.archive;
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".sqlite")) continue;
        const id = file.slice(0, -".sqlite".length);
        const path = join(dir, file);
        try {
          const db = new Database(path, { readonly: true });
          const meta = readSessionMeta(db);
          db.close();
          out.push({ ...meta, path, archived });
        } catch {
          // skip unreadable
        }
      }
    }
    return out;
  }

  archive(id: string): void {
    this.close(id);
    const src = this.pathFor(id);
    if (!existsSync(src)) throw new Error(`session not found: ${id}`);
    mkdirSync(this.paths.archive, { recursive: true });
    const dst = join(this.paths.archive, `${id}.sqlite`);
    renameSync(src, dst);
    for (const ext of ["-wal", "-shm"]) {
      const s = src + ext;
      if (existsSync(s)) rmSync(s);
    }
    const db = new Database(dst);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      "archived_at",
      new Date().toISOString(),
    );
    db.close();
  }

  restore(id: string): void {
    this.close(id);
    const src = join(this.paths.archive, `${id}.sqlite`);
    if (!existsSync(src)) throw new Error(`archived session not found: ${id}`);
    const dst = this.pathFor(id);
    renameSync(src, dst);
    for (const ext of ["-wal", "-shm"]) {
      const s = src + ext;
      if (existsSync(s)) rmSync(s);
    }
    const db = new Database(dst);
    db.prepare("UPDATE meta SET value = ? WHERE key = ?").run("", "archived_at");
    db.close();
  }

  sweepExpired(): string[] {
    const archived: string[] = [];
    if (!existsSync(this.paths.sessions)) return archived;
    const now = Date.now();
    for (const file of readdirSync(this.paths.sessions)) {
      if (!file.endsWith(".sqlite")) continue;
      const id = file.slice(0, -".sqlite".length);
      try {
        const path = join(this.paths.sessions, file);
        const db = new Database(path, { readonly: true });
        const meta = readSessionMeta(db);
        db.close();
        if (meta.archive_at) {
          const t = Date.parse(meta.archive_at);
          if (!Number.isNaN(t) && t <= now) {
            this.archive(id);
            archived.push(id);
          }
        }
      } catch {
        // ignore
      }
    }
    return archived;
  }

  pathFor(id: string): string {
    return join(this.paths.sessions, `${id}.sqlite`);
  }

  exists(id: string): boolean {
    return existsSync(this.pathFor(id));
  }

  isArchived(id: string): boolean {
    return existsSync(join(this.paths.archive, `${id}.sqlite`));
  }
}

export { SEP };
export { openSessionDb, readSessionMeta } from "./db.js";
export type { SessionDb } from "./db.js";
export type * from "./types.js";
