#!/usr/bin/env bun
const DOC = `ADW Build Review — implement, then confirm it is what was asked for.

Usage:
    bun adws/adw_build_review.ts "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> builder -> reviewer [-> builder(revise) -> reviewer ... bounded]

Review is not testing. Tests answer "does it run"; the reviewer answers "is this
the thing that was asked for" — it reads the spec (\`plan.md\` from a prior plan
phase if the session has one, else the prompt verbatim), reads the code that was
written, and rules on each requirement.

Like the tester, the reviewer's phase succeeds when it RUNS and REPORTS. A
rejection does not fail the phase; it fails the run, checked at the end, after
the bounded revise loop has had its chances.
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as session from "./adw_modules/session.ts";
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/cli.ts";
import { BuildOutput, ReviewOutput } from "./adw_modules/dataTypes.ts";

const REQUIRED_AGENTS = ["builder", "reviewer"];
const MAX_REVISION_LOOPS = 3;

async function main(
  prompt: string,
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

  let previous = await run.phase({
    name: "build",
    kind: "agent",
    owner: "builder",
    description: "Implement the request",
  }, async (ph) => {
    return await ph.call({
      outputType: BuildOutput,
      prompt,
      gates: [gates.diffMatchesClaims],
    }) as BuildOutput;
  });

  let review: ReviewOutput | null = null;
  for (let i = 1; i <= MAX_REVISION_LOOPS; i++) {
    review = await run.phase({
      name: `review_${i}`,
      kind: "agent",
      owner: "reviewer",
      description: "Rule on every requirement in the spec, against the code on disk",
    }, async (ph) => {
      return await ph.call({
        outputType: ReviewOutput,
        prompt,
        previous,
        gates: [gates.artifactsExist, gates.verdictConsistent],
      }) as ReviewOutput;
    });

    if (review.approved) {
      break;
    }
    if (i === MAX_REVISION_LOOPS) {
      break;
    }

    previous = await run.phase({
      name: `revise_${i}`,
      kind: "agent",
      owner: "builder",
      retries: 1,
      description: "Close every blocking finding the reviewer named",
    }, async (ph) => {
      return await ph.call({
        outputType: BuildOutput,
        prompt,
        previous: review,
        gates: [gates.diffMatchesClaims],
      }) as BuildOutput;
    });
  }

  return run.finish({
    accepted: review !== null && review.approved,
    reason: `the reviewer never approved after ${MAX_REVISION_LOOPS} revision(s)`,
  });
}

await runMain(async () => {
  const args = parseArgs({
    description: DOC,
    positional: [{ name: "prompt", help: "inline text or a path to a prompt file" }],
    options: [
      { name: "--config", default: "adws/adw_sssf_config/sssf.config.yaml" },
      { name: "--adw-id", default: null, help: "join or pin an existing session" },
    ],
  });
  return main(utils.resolvePrompt(args.prompt!), args.config!, args.adw_id);
});
