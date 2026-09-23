import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL } from "./harness.ts";

const GOLD_INSTALL = join(import.meta.dir, "python-gold/scripts/install.py");
const PORT_INSTALL = join(SKILL, "scripts/install.ts");

const ADWS = [
  "adw_prompt",
  "adw_scout",
  "adw_plan",
  "adw_build",
  "adw_quality",
  "adw_plan_build",
  "adw_build_test",
  "adw_build_review",
  "adw_plan_build_test",
  "adw_plan_build_test_quality",
  "adw_document",
  "adw_simple_sdlc",
];

function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path, rel));
    else out.push(rel);
  }
  return out.sort();
}

async function install(kind: "gold" | "port", dest: string): Promise<{ exit: number; stdout: string }> {
  const cmd = kind === "gold" ? ["uv", "run", GOLD_INSTALL] : ["bun", PORT_INSTALL];
  const proc = Bun.spawn(cmd, {
    cwd: dest,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", TERM: "dumb" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  return { exit: await proc.exited, stdout };
}

describe("gold vs port install", () => {
  test("stamps the same dests, with .ts scripts and a compat ring on the port", async () => {
    const goldDir = mkdtempSync(join(tmpdir(), "sssf-install-gold-"));
    const portDir = mkdtempSync(join(tmpdir(), "sssf-install-port-"));
    const gold = await install("gold", goldDir);
    const port = await install("port", portDir);
    expect(gold.exit).toBe(0);
    expect(port.exit).toBe(0);
    const goldFiles = listFiles(goldDir);
    const portFiles = listFiles(portDir);

    for (const name of ADWS) {
      expect(goldFiles).toContain(`adws/${name}.py`);
      expect(portFiles).toContain(`adws/${name}.ts`);
    }
    for (const shared of [
      "adws/adw_sssf_config/sssf.config.yaml",
      ".env.sample",
      "justfile",
      ".gitignore",
      "adws/adw_data/prompt_engineering/scout/system.md",
      "adws/adw_data/harness_engineering/subagents.ts",
    ]) {
      expect(goldFiles).toContain(shared);
      expect(portFiles).toContain(shared);
    }
    expect(portFiles.some((p) => p.startsWith("adws/adw_modules/compat/"))).toBe(true);
    expect(goldFiles.some((p) => p.startsWith("adws/adw_modules/compat/"))).toBe(false);
    for (const name of ["package.json", "tsconfig.json", "eslint.config.ts", "eslint.config.js"]) {
      expect(portFiles.some((p) => p === name || p.endsWith(`/${name}`))).toBe(false);
    }

    const goldGi = readFileSync(join(goldDir, ".gitignore"), "utf8").split("\n");
    const portGi = readFileSync(join(portDir, ".gitignore"), "utf8").split("\n");
    for (const entry of ["adws/adw_data/sessions/", "adws/adw_data/sssf.db*", ".env"]) {
      expect(goldGi).toContain(entry);
      expect(portGi).toContain(entry);
    }
    expect(goldGi).toContain("__pycache__/");
    expect(goldGi).toContain("*.pyc");
    expect(portGi).not.toContain("__pycache__/");
    expect(portGi).not.toContain("*.pyc");

    expect(gold.stdout).toContain("uv run adws/adw_prompt.py");
    expect(port.stdout).toContain("bun adws/adw_prompt.ts");

    rmSync(goldDir, { recursive: true, force: true });
    rmSync(portDir, { recursive: true, force: true });
  }, 60_000);

  test("second install without --force is idempotent", async () => {
    const portDir = mkdtempSync(join(tmpdir(), "sssf-install-idemp-"));
    const first = await install("port", portDir);
    const second = await install("port", portDir);
    expect(first.exit).toBe(0);
    expect(second.exit).toBe(0);
    expect(second.stdout).toContain("skipped (already exist, use --force to overwrite):");
    rmSync(portDir, { recursive: true, force: true });
  }, 60_000);
});
