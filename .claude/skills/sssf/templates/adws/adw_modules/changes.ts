import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as gitHelper from "./gitHelper.ts";
import { baseRef, changeSet, type ChangeCapture, type ChangeSet, type ChangesOutput } from "./dataTypes.ts";
import type { Run } from "./runner.ts";
import { RuntimeError } from "./utils.ts";
import { pyRepr } from "./compat/format.ts";

const DIFF_FILENAME = "changes.diff";

function splitlines(text: string): string[] {
  if (text.length === 0) return [];
  // eslint-disable-next-line no-control-regex -- Python splitlines includes FS/GS/RS
  const parts = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export function resolveBase(ref: string) {
  if (!gitHelper.isRepo()) {
    throw new RuntimeError(
      "not a git repository — change capture needs one. Run `git init` in " +
        "the repo root before running an ADW that documents a change.",
    );
  }
  if (!gitHelper.refExists(ref)) {
    throw new RuntimeError(
      `base ref ${pyRepr(ref)} does not exist in this repository — pass --base ` +
        `with a ref that does (e.g. --base master, --base HEAD~1).`,
    );
  }

  const base = baseRef(ref, gitHelper.mergeBase(ref, "HEAD"));
  if (gitHelper.shortSha(base.commit) !== gitHelper.shortSha("HEAD")) {
    base.reason = `HEAD is ahead of ${base.label} — diffing every commit since, ` +
      `plus the working tree`;
  } else if (gitHelper.isDirty()) {
    base.reason = `HEAD is on ${base.label} — diffing the uncommitted working tree`;
  } else if (gitHelper.refExists("HEAD~1")) {
    base.commit = gitHelper.rev("HEAD~1");
    base.reason = `HEAD is on ${base.label} with a clean tree — falling back to ` +
      `the last commit`;
  } else {
    base.reason = `HEAD is on ${base.label} with a clean tree and no parent commit`;
  }
  return base;
}

export function capture(run: Run, params: ChangeCapture): ChangeSet {
  const base = resolveBase(params.base);
  const files = gitHelper.diffFiles(base.commit);
  const untracked = params.includeUntracked ? gitHelper.untrackedFiles() : [];
  const [insertions, deletions] = gitHelper.diffCounts(base.commit);
  const stat = gitHelper.diffStat(base.commit);

  let text = gitHelper.diffText(base.commit);
  const lines = splitlines(text);
  const truncated = lines.length > params.maxDiffLines;
  if (truncated) {
    text = lines.slice(0, params.maxDiffLines).join("\n");
    text += `\n\n[truncated at ${params.maxDiffLines} lines of ` +
      `${lines.length} — run \`git diff ${base.commit}\` for the rest]`;
  }

  const untrackedBlock = untracked.length
    ? untracked.map((f) => `  ${f}`).join("\n")
    : "  (none)";
  const diffPath = join(run.contextHandoffDir, DIFF_FILENAME);
  writeFileSync(
    diffPath,
    `# changes since ${base.label} @ ${gitHelper.shortSha(base.commit)}\n` +
      `# ${base.reason}\n` +
      `# +${insertions} -${deletions} across ${files.length} tracked file(s)\n\n` +
      `## stat\n${stat || "  (no tracked changes)"}\n\n` +
      `## untracked files\n${untrackedBlock}\n\n` +
      `## diff\n${text}\n`,
  );

  return changeSet({
    base,
    files,
    untracked,
    insertions,
    deletions,
    stat,
    diff_path: diffPath,
    truncated,
  });
}

export function asEnvelope(changes: ChangeSet, notes = ""): ChangesOutput {
  const total = changes.files.length + changes.untracked.length;
  return {
    status: "success",
    summary: `${total} file(s) changed since ${changes.base.label} ` +
      `(+${changes.insertions} -${changes.deletions})`,
    artifacts: [changes.diff_path],
    notes_for_next_agent: notes,
    base: `${changes.base.label} @ ${gitHelper.shortSha(changes.base.commit)} ` +
      `— ${changes.base.reason}`,
    changed_files: [...changes.files, ...changes.untracked],
    insertions: changes.insertions,
    deletions: changes.deletions,
    stat: changes.stat,
    diff_path: changes.diff_path,
  };
}
