import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const MAKE = join(REPO, ".claude/skills/sssf/scripts/makeAdw.ts");
const GOLDEN = join(import.meta.dir, "fixtures/make_adw/adw_plan_build.golden");
const MODULES = join(REPO, ".claude/skills/sssf/factory/adws/adw_modules");
const TSC = join(REPO, "node_modules/.bin/tsc");

async function run(cmd: string[], cwd: string): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exit: await proc.exited, stdout, stderr };
}

describe("makeAdw", () => {
  test("golden", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sssf-makeadw-"));
    try {
      const result = await run(["bun", MAKE, "--name", "plan_build", "--agents", "planner,builder"], dir);
      expect(result.exit).toBe(0);
      const got = readFileSync(join(dir, "adws/adw_plan_build.ts"));
      const want = readFileSync(GOLDEN);
      if (!got.equals(want)) expect(got.toString("utf8")).toBe(want.toString("utf8"));
      expect(got.equals(want)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("typechecks", async () => {
    const dir = await sdlcDir();
    const tsconfig = {
      compilerOptions: {
        noEmit: true,
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        types: ["bun"],
        typeRoots: [join(REPO, "node_modules/@types")],
      },
      include: ["adws/adw_sdlc.ts", join(REPO, "bun-yaml.d.ts")],
    };
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    const checked = await run([TSC, "-p", join(dir, "tsconfig.json")], dir);
    if (checked.exit !== 0) console.log(checked.stdout);
    expect(checked.exit, checked.stderr).toBe(0);
  }, 60_000);

  test("runs to argparse", async () => {
    const dir = await sdlcDir();
    const result = await run(["bun", "adws/adw_sdlc.ts", "--help"], dir);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain(
      "Phases: engineer(request) -> planner -> builder -> reviewer -> builder -> documenter",
    );
  }, 60_000);
});

let sdlc: Promise<string> | null = null;

afterAll(async () => {
  if (sdlc) rmSync(await sdlc, { recursive: true, force: true });
});

function sdlcDir(): Promise<string> {
  sdlc ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "sssf-makeadw-sdlc-"));
    mkdirSync(join(dir, "adws"), { recursive: true });
    cpSync(MODULES, join(dir, "adws/adw_modules"), { recursive: true });
    const result = await run(
      ["bun", MAKE, "--name", "sdlc", "--agents", "planner,builder,reviewer,builder,documenter"],
      dir,
    );
    if (result.exit !== 0) throw new Error(result.stderr || result.stdout);
    return dir;
  })();
  return sdlc;
}
