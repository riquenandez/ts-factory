import { cwd } from "node:process";
import { resolve } from "node:path";
import { spawnCaptured } from "./compat/shell.ts";

function git(...args: string[]): string {
  const result = spawnCaptured(["git", ...args]);
  if (result.returncode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function currentBranch(): string {
  return git("rev-parse", "--abbrev-ref", "HEAD");
}

export function createBranch(name: string): string {
  git("checkout", "-b", name);
  return name;
}

export function isRepo(): boolean {
  const result = spawnCaptured(["git", "rev-parse", "--git-dir"]);
  return result.returncode === 0;
}

export function repoRoot(): string {
  if (isRepo()) return resolve(git("rev-parse", "--show-toplevel"));
  return resolve(cwd());
}

export function commitAll(message: string): string {
  if (!isRepo()) {
    throw new Error(
      "not a git repository — a commit phase needs one. Run `git init` in the " +
        "repo root (and make a first commit) before running an ADW that commits.",
    );
  }
  git("add", "-A");
  if (!git("status", "--porcelain")) {
    throw new Error("nothing to commit — the preceding phases changed no files");
  }
  git("commit", "-m", message);
  return git("rev-parse", "--short", "HEAD");
}

export function refExists(ref: string): boolean {
  const result = spawnCaptured(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return result.returncode === 0;
}

export function rev(ref = "HEAD"): string {
  return git("rev-parse", ref);
}

export function shortSha(ref = "HEAD"): string {
  return git("rev-parse", "--short", ref);
}

export function mergeBase(ref: string, other = "HEAD"): string {
  return git("merge-base", ref, other);
}

export function isDirty(): boolean {
  return Boolean(git("status", "--porcelain"));
}

export function untrackedFiles(): string[] {
  const out = git("ls-files", "--others", "--exclude-standard");
  return out.split("\n").filter(Boolean);
}

export function diffFiles(base: string): string[] {
  const out = git("diff", "--name-only", base);
  return out.split("\n").filter(Boolean);
}

export function diffStat(base: string): string {
  return git("diff", "--stat", base);
}

export function diffCounts(base: string): [number, number] {
  let insertions = 0;
  let deletions = 0;
  for (const line of git("diff", "--numstat", base).split("\n")) {
    if (!line) continue;
    const [added, removed] = line.split("\t");
    if (added && /^\d+$/.test(added)) insertions += Number(added);
    if (removed && /^\d+$/.test(removed)) deletions += Number(removed);
  }
  return [insertions, deletions];
}

export function diffText(base: string): string {
  return git("diff", base);
}
