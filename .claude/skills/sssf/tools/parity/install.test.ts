import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SKILL = join(import.meta.dir, "../..");
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

function list_files(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...list_files(path, rel));
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
    const gold_dir = mkdtempSync(join(tmpdir(), "sssf-install-gold-"));
    const port_dir = mkdtempSync(join(tmpdir(), "sssf-install-port-"));
    const gold = await install("gold", gold_dir);
    const port = await install("port", port_dir);
    expect(gold.exit).toBe(0);
    expect(port.exit).toBe(0);
    const gold_files = list_files(gold_dir);
    const port_files = list_files(port_dir);

    for (const name of ADWS) {
      expect(gold_files).toContain(`adws/${name}.py`);
      expect(port_files).toContain(`adws/${name}.ts`);
    }
    for (const shared of [
      "adws/adw_sssf_config/sssf.config.yaml",
      ".env.sample",
      "justfile",
      ".gitignore",
      "adws/adw_data/prompt_engineering/scout/system.md",
      "adws/adw_data/harness_engineering/subagents.ts",
    ]) {
      expect(gold_files).toContain(shared);
      expect(port_files).toContain(shared);
    }
    expect(port_files.some((p) => p.startsWith("adws/adw_modules/compat/"))).toBe(true);
    expect(gold_files.some((p) => p.startsWith("adws/adw_modules/compat/"))).toBe(false);
    for (const name of ["package.json", "tsconfig.json", "eslint.config.ts", "eslint.config.js"]) {
      expect(port_files.some((p) => p === name || p.endsWith(`/${name}`))).toBe(false);
    }

    const gold_gi = readFileSync(join(gold_dir, ".gitignore"), "utf8").split("\n");
    const port_gi = readFileSync(join(port_dir, ".gitignore"), "utf8").split("\n");
    for (const entry of ["adws/adw_data/sessions/", "adws/adw_data/sssf.db*", ".env"]) {
      expect(gold_gi).toContain(entry);
      expect(port_gi).toContain(entry);
    }
    expect(gold_gi).toContain("__pycache__/");
    expect(gold_gi).toContain("*.pyc");
    expect(port_gi).not.toContain("__pycache__/");
    expect(port_gi).not.toContain("*.pyc");

    expect(gold.stdout).toContain("uv run adws/adw_prompt.py");
    expect(port.stdout).toContain("bun adws/adw_prompt.ts");

    rmSync(gold_dir, { recursive: true, force: true });
    rmSync(port_dir, { recursive: true, force: true });
  }, 60_000);

  test("second install without --force is idempotent", async () => {
    const port_dir = mkdtempSync(join(tmpdir(), "sssf-install-idemp-"));
    const first = await install("port", port_dir);
    const second = await install("port", port_dir);
    expect(first.exit).toBe(0);
    expect(second.exit).toBe(0);
    expect(second.stdout).toContain("skipped (already exist, use --force to overwrite):");
    rmSync(port_dir, { recursive: true, force: true });
  }, 60_000);
});
