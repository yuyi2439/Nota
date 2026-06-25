import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersonaManager } from "../src/core/persona/index.js";
import { PATHS } from "../src/core/paths.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "nota-pers-"));
  (PATHS as { personas: string }).personas = join(tmpHome, "personas");
  (PATHS as { personaConfig: string }).personaConfig = join(
    tmpHome,
    "personas",
    "config.sqlite",
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 50));
  rmSync(tmpHome, { recursive: true, force: true });
});

function makePm() {
  return new PersonaManager();
}

describe("PersonaManager", () => {
  it("starts with no persona", () => {
    const pm = makePm();
    expect(pm.list()).toHaveLength(0);
    expect(pm.hasAnyPersona()).toBe(false);
    pm.close();
  });

  it("creates a persona with workspace dir", () => {
    const pm = makePm();
    pm.create("Writer");
    const rec = pm.get("Writer");
    expect(rec?.name).toBe("Writer");
    expect(existsSync(pm.workspacePath("Writer"))).toBe(true);
    pm.close();
  });

  it("renames persona and its workspace dir", () => {
    const pm = makePm();
    pm.create("Temp");
    writeFileSync(join(pm.workspacePath("Temp"), "prompt.md"), "hi");
    pm.rename("Temp", "Final");
    expect(pm.get("Temp")).toBeUndefined();
    expect(pm.get("Final")?.name).toBe("Final");
    expect(existsSync(join(pm.workspacePath("Final"), "prompt.md"))).toBe(true);
    pm.close();
  });

  it("loads prompts from workspace markdown files", () => {
    const pm = makePm();
    pm.create("Coder");
    const dir = pm.workspacePath("Coder");
    writeFileSync(join(dir, "01-role.md"), "# Role\nYou are a coder.");
    writeFileSync(join(dir, "02-style.md"), "# Style\nBe concise.");
    const prompts = pm.loadPrompts("Coder");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.filename).toBe("01-role.md");
    expect(prompts[1]?.filename).toBe("02-style.md");
    pm.close();
  });

  it("builds system prompt from workspace files", () => {
    const pm = makePm();
    pm.create("Dev");
    const dir = pm.workspacePath("Dev");
    writeFileSync(join(dir, "role.md"), "You write code.");
    const sys = pm.buildSystemPrompt("Dev");
    expect(sys).toContain("role.md");
    expect(sys).toContain("You write code.");
    pm.close();
  });

  it("falls back to default prompt when no files", () => {
    const pm = makePm();
    pm.create("Empty");
    const sys = pm.buildSystemPrompt("Empty");
    expect(sys).toContain("Empty");
    pm.close();
  });

  it("sets and updates main session", () => {
    const pm = makePm();
    pm.create("P");
    pm.setMainSession("P", "session-123");
    expect(pm.get("P")?.main_session_id).toBe("session-123");
    pm.setMainSession("P", null);
    expect(pm.get("P")?.main_session_id).toBeNull();
    pm.close();
  });
});
