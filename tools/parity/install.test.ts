import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL } from "./harness.ts";

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

async function install(dest: string): Promise<{ exit: number; stdout: string }> {
  const proc = Bun.spawn(["bun", PORT_INSTALL], {
    cwd: dest,
    env: { ...process.env, TERM: "dumb" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  return { exit: await proc.exited, stdout };
}

describe("install", () => {
  test("stamps the same dests, with .ts scripts and a compat ring on the port", async () => {
    const dest = mkdtempSync(join(tmpdir(), "sssf-install-port-"));
    const port = await install(dest);
    expect(port.exit).toBe(0);
    const portFiles = listFiles(dest);
    expect(listFiles(dest)).toMatchSnapshot("stamped files");

    for (const name of ADWS) {
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
      expect(portFiles).toContain(shared);
    }
    expect(portFiles.some((p) => p.startsWith("adws/adw_modules/compat/"))).toBe(true);
    for (const name of ["package.json", "tsconfig.json", "eslint.config.ts", "eslint.config.js"]) {
      expect(portFiles.some((p) => p === name || p.endsWith(`/${name}`))).toBe(false);
    }

    const portGi = readFileSync(join(dest, ".gitignore"), "utf8").split("\n");
    for (const entry of ["adws/adw_data/sessions/", "adws/adw_data/sssf.db*", ".env"]) {
      expect(portGi).toContain(entry);
    }
    expect(portGi).not.toContain("__pycache__/");
    expect(portGi).not.toContain("*.pyc");

    expect(port.stdout).toContain("bun adws/adw_prompt.ts");

    rmSync(dest, { recursive: true, force: true });
  }, 60_000);

  test("second install without --force is idempotent", async () => {
    const portDir = mkdtempSync(join(tmpdir(), "sssf-install-idemp-"));
    const first = await install(portDir);
    const second = await install(portDir);
    expect(first.exit).toBe(0);
    expect(second.exit).toBe(0);
    expect(second.stdout).toContain("skipped (already exist, use --force to overwrite):");
    rmSync(portDir, { recursive: true, force: true });
  }, 60_000);
});
