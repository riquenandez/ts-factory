#!/usr/bin/env bun
const DOC = `ADW Document — write up the work that was just done, from the diff.

Phases: engineer(request) -> code(changes) -> documenter

This runs AFTER a build, and the guard is structural rather than advisory: the
change capture is a code phase, and an empty diff raises there — before the
documenter is ever spawned. There is nothing to document until something was
built, and the phase says so instead of paying an agent to discover it.

\`git diff\` against \`--base\` (main by default) is what "the latest changes"
means here; see adw_modules/changes.ts for how the base commit is resolved on a
branch, on main, and on a clean tree right after a chain committed.
`;

import * as agents from "./adw_modules/agents.ts";
import * as changes from "./adw_modules/changes.ts";
import * as gates from "./adw_modules/gates.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { DocumentOutput } from "./adw_modules/dataTypes.ts";

const REQUIRED_AGENTS = ["documenter"];

const DOCUMENT_NOTES = (
  "Read diff_path in full before writing. Document only what the "
  + "diff shows, then copy the write-up into app_docs/ as your task "
  + "describes."
);

await adw(DOC, async ({ cfg, prompt, adwId, args }) => {
  const base = args.base ?? "main";
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt);

  const changeset = await run.phase({
    name: "changes",
    kind: "code",
    owner: "git",
    description: `Diff the working tree against ${base} — the change to be written up`,
  }, async (ph) => {
    const captured = changes.capture(run, { base, maxDiffLines: 2000, includeUntracked: true });
    ph.log({
      base: `${captured.base.label} @ ${captured.base.commit.slice(0, 7)}`,
      reason: captured.base.reason,
      files: captured.files.length + captured.untracked.length,
      lines: `+${captured.insertions} -${captured.deletions}`,
      diff: captured.diff_path,
    });
    if (captured.empty) {
      throw new Error(
        `nothing changed since ${captured.base.label} (${captured.base.reason}) `
        + `— documenting runs after a build. Build something first, or point `
        + `--base at the ref the work should be measured from.`,
      );
    }
    return captured;
  });

  await run.phase({
    name: "document",
    kind: "agent",
    owner: "documenter",
    retries: 1,
    description: "Turn the captured diff into a write-up an engineer can read",
  }, async (ph) => {
    await ph.call({
      outputType: DocumentOutput,
      prompt,
      previous: changes.asEnvelope(changeset, DOCUMENT_NOTES),
      gates: [gates.artifactsExist, gates.filesNonEmpty],
    });
  });

  return run.finish();
}, [
  { name: "--base", default: "main", help: "ref the change is measured against" },
]);
