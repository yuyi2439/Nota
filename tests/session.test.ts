import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../src/core/session/index.js";

let tmpHome: string;
let sessionsDir: string;
let archiveDir: string;
let active: SessionManager[] = [];

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "nota-test-"));
  sessionsDir = join(tmpHome, "sessions");
  archiveDir = join(tmpHome, "sessions", "archive");
  active = [];
});

afterEach(async () => {
  for (const sm of active) sm.closeAll();
  await new Promise((r) => setTimeout(r, 50));
  rmSync(tmpHome, { recursive: true, force: true });
});

function makeSm() {
  const sm = new SessionManager({ sessions: sessionsDir, archive: archiveDir });
  active.push(sm);
  return sm;
}

describe("SessionManager", () => {
  it("creates and opens a session", () => {
    const sm = makeSm();
    const meta = sm.create({ creator: "cli" });
    expect(meta.creator).toBe("cli");
    expect(meta.archive_at).toBeTruthy();
    expect(sm.exists(meta.id)).toBe(true);

    const loaded = sm.meta(meta.id);
    expect(loaded.creator).toBe("cli");
  });

  it("appends and reads messages", () => {
    const sm = makeSm();
    const { id } = sm.create({ creator: "cli" });
    sm.appendMessage(id, { role: "user", content: "hello" });
    sm.appendMessage(id, { role: "assistant", content: "hi there" });
    const history = sm.history(id);
    expect(history).toHaveLength(2);
    expect(history[0]?.content).toBe("hello");
    expect(history[1]?.content).toBe("hi there");
  });

  it("archives and restores a session", () => {
    const sm = makeSm();
    const { id } = sm.create({ creator: "cli" });
    sm.appendMessage(id, { role: "user", content: "before archive" });
    sm.archive(id);
    expect(sm.exists(id)).toBe(false);
    expect(sm.isArchived(id)).toBe(true);

    sm.restore(id);
    expect(sm.exists(id)).toBe(true);
    const history = sm.history(id);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe("before archive");
  });

  it("sweeps expired sessions", () => {
    const sm = makeSm();
    const { id } = sm.create({ creator: "cli" });
    const past = new Date(Date.now() - 1000).toISOString();
    sm.open(id).db
      .prepare("UPDATE meta SET value = ? WHERE key = ?")
      .run(past, "archive_at");
    sm.close(id);

    const swept = sm.sweepExpired();
    expect(swept).toContain(id);
    expect(sm.exists(id)).toBe(false);
    expect(sm.isArchived(id)).toBe(true);
  });

  it("lists active and archived sessions", () => {
    const sm = makeSm();
    const a = sm.create({ creator: "cli" });
    const b = sm.create({ creator: "cli" });
    sm.archive(b.id);

    const list = sm.list();
    const ids = list.map((s) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    const archivedB = list.find((s) => s.id === b.id);
    expect(archivedB?.archived).toBe(true);
    const activeA = list.find((s) => s.id === a.id);
    expect(activeA?.archived).toBe(false);
  });
});
