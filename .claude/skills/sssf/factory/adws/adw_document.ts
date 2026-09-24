#!/usr/bin/env bun
const DOC = `ADW Document — write up the work that was just done, from the diff.

Usage:
    bun adws/adw_document.ts "<prompt or path/to/prompt.md>" [--base main] [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

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
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/cli.ts";
import { DocumentOutput } from "./adw_modules/dataTypes.ts";
import { RuntimeError } from "./adw_modules/utils.ts";

const REQUIRED_AGENTS = ["documenter"];

const DOCUMENT_NOTES = (
  "Read diff_path in full before writing. Document only what the "
  + "diff shows, then copy the write-up into app_docs/ as your task "
  + "describes."
);

async function main(
  prompt: string,
  base: string = "main",
  config: string = "adws/adw_sssf_config/sssf.config.yaml",
  adwId: string | null = null,
): Promise<number> {
  const cfg = agents.loadConfig(config);
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.phase({
    name: "request",
    kind: "engineer",
    owner: run.engineer,
    description: "Capture the incoming ask",
  }, async (ph) => {
    ph.log({ input: prompt });
  });

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
      throw new RuntimeError(
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
}

await runMain(async () => {
  const args = parseArgs({
    description: DOC,
    positional: [{ name: "prompt", help: "inline text or a path to a prompt file" }],
    options: [
      { name: "--base", default: "main", help: "ref the change is measured against" },
      { name: "--config", default: "adws/adw_sssf_config/sssf.config.yaml" },
      { name: "--adw-id", default: null, help: "join or pin an existing session" },
    ],
  });
  return main(utils.resolvePrompt(args.prompt!), args.base!, args.config!, args.adw_id);
});
