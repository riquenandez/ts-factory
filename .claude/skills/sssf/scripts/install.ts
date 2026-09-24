#!/usr/bin/env bun
/** /install — stamp the SSSF factory from the skill into the cwd. Idempotent.

Usage:
    bun <skill>/scripts/install.ts [--force]

Stamps: adws/ (modules + starter ADWs), adws/adw_data/prompt_engineering/
(5 starter agents), adws/adw_sssf_config/sssf.config.yaml, .env.sample,
.gitignore entries.
Existing files are skipped unless --force.
*/

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "../factory/adws/adw_modules/compat/cli.ts";

const TEMPLATES = join(dirname(import.meta.dir), "factory");

const GITIGNORE_ENTRIES = [
  "adws/adw_data/sessions/",
  "adws/adw_data/sssf.db*",
  ".env",
];

const DOC = `stamp the SSSF factory from the skill into the cwd. Idempotent.`;

function stamp(src: string, dest: string, force: boolean, stamped: string[], skipped: string[]): void {
  if (statSync(src).isDirectory()) {
    for (const name of readdirSync(src).sort()) {
      if (name === "__pycache__") continue;
      stamp(join(src, name), join(dest, name), force, stamped, skipped);
    }
    return;
  }
  if (existsSync(dest) && !force) {
    skipped.push(dest);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  stamped.push(dest);
}

function ensureGitignore(root: string, stamped: string[]): void {
  const gitignore = join(root, ".gitignore");
  const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8").split("\n") : [];
  const missing = GITIGNORE_ENTRIES.filter((e) => !existing.includes(e));
  if (missing.length) {
    appendFileSync(gitignore, "\n# sssf runtime\n" + missing.join("\n") + "\n");
    stamped.push(`${gitignore} (+${missing.length} entries)`);
  }
}

const args = parseArgs({
  description: DOC,
  positional: [],
  options: [{ name: "--force", dest: "force", action: "store_true", help: "overwrite existing files" }],
});
const force = args.force === true;

const root = process.cwd();
const stamped: string[] = [];
const skipped: string[] = [];

stamp(join(TEMPLATES, "adws"), join(root, "adws"), force, stamped, skipped);
stamp(join(TEMPLATES, "prompt_engineering"), join(root, "adws", "adw_data", "prompt_engineering"), force, stamped, skipped);
stamp(join(TEMPLATES, "harness_engineering"), join(root, "adws", "adw_data", "harness_engineering"), force, stamped, skipped);
stamp(join(TEMPLATES, "sssf.config.yaml"), join(root, "adws", "adw_sssf_config", "sssf.config.yaml"), force, stamped, skipped);
stamp(join(TEMPLATES, "env.sample"), join(root, ".env.sample"), force, stamped, skipped);
stamp(join(TEMPLATES, "justfile"), join(root, "justfile"), force, stamped, skipped);
ensureGitignore(root, stamped);

console.log(`sssf installed into ${root}`);
console.log(`  stamped: ${stamped.length} file(s)`);
for (const s of stamped) console.log(`    + ${s}`);
if (skipped.length) {
  console.log(`  skipped (already exist, use --force to overwrite): ${skipped.length}`);
}
console.log("\nnext steps:");
console.log("  1. cp .env.sample .env   # then set the key(s) your roster needs");
console.log("  2. just demo             # two cheap read-only runs, end to end");
console.log("  3. just sessions         # what just happened");
console.log("  4. just obs              # the trace UI, needs bun");
console.log("\n  no just? the raw form of step 2 is:");
console.log(`     bun adws/adw_prompt.ts "say hello" --agent scout`);
