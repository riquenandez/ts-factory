#!/usr/bin/env bun
const DOC = `ADW Plan Build Test Quality — full agent chain plus deterministic quality.

Usage:
    bun adws/adw_plan_build_test_quality.ts "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> planner -> builder -> [code(verify) -> code(test) -> builder(fix)] bounded -> git(commit)

Verify and test are CODE, not agents. Their commands are known, so running them
needs no judgement — only repairing them does. A failing block does not fail its
phase: the runner did its job, the code is what failed. The failure becomes an
envelope and flows back into the builder, and only an exhausted repair loop
fails the run.
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as gitHelper from "./adw_modules/git_helper.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/compat/cli.ts";
import { BuildOutput, PlanOutput, type QualityResult } from "./adw_modules/data_types.ts";

const REQUIRED_AGENTS = ["planner", "builder"];
const MAX_FIX_LOOPS = 3;

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

  const plan = await run.phase({
    name: "plan",
    kind: "agent",
    owner: "planner",
    description: "Turn the request into an implementable plan",
  }, async (ph) => {
    return await ph.call({
      outputType: PlanOutput,
      prompt,
      gates: [gates.artifactsExist, gates.filesNonEmpty],
    }) as PlanOutput;
  });

  let previous = await run.phase({
    name: "build",
    kind: "agent",
    owner: "builder",
    description: "Implement the plan exactly",
  }, async (ph) => {
    return await ph.call({
      outputType: BuildOutput,
      prompt,
      previous: plan,
      gates: [gates.diffMatchesClaims],
    }) as BuildOutput;
  });

  function record(ph: { log: (payload: Record<string, unknown>) => void }, result: QualityResult): void {
    const passed = result.checks.filter((check) => check.passed).length;
    ph.log({
      passed: result.passed,
      checks: `${passed}/${result.checks.length}`,
      artifacts: result.artifacts.join(", "),
    });
  }

  let test_result: QualityResult | null = null;
  let quality_result: QualityResult | null = null;
  for (let i = 1; i <= MAX_FIX_LOOPS; i++) {
    quality_result = await run.phase({
      name: `verify_${i}`,
      kind: "code",
      owner: "quality",
      description: "Lint, typecheck, and build before testing",
    }, async (ph) => {
      const result = quality.runQuality(run);
      record(ph, result);
      return result;
    });

    // runQuality() already includes the test block; a repo that wants tests
    // in their own phase can split them out the way this comment does.
    test_result = quality_result;

    if (quality_result.passed && test_result.passed) {
      break;
    }
    if (i === MAX_FIX_LOOPS) {
      break;
    }

    // Whichever block failed becomes the builder's spec — verbatim command
    // output, no parser standing between the failure and the fix.
    const broken = !quality_result.passed ? quality_result : test_result;
    const what = !quality_result.passed ? "verification" : "tests";
    previous = await run.phase({
      name: `fix_${i}`,
      kind: "agent",
      owner: "builder",
      retries: 1,
      description: `Resolve the reported ${what} failures`,
    }, async (ph) => {
      return await ph.call({
        outputType: BuildOutput,
        prompt,
        previous: quality.asEnvelope(broken, what),
        gates: [gates.diffMatchesClaims],
      }) as BuildOutput;
    });
  }

  const verified = (
    quality_result !== null && quality_result.passed
    && test_result !== null && test_result.passed
  );
  if (verified) {
    await run.phase({
      name: "commit",
      kind: "code",
      owner: "git",
      description: "Commit the tested and quality-verified working tree",
    }, async (ph) => {
      const message = previous.commit_message || `sssf(${run.adwId}): ${previous.summary}`;
      ph.log({ sha: gitHelper.commitAll(message), message });
    });
  }

  return run.finish({
    accepted: verified,
    reason: `verify/test never came back clean after ${MAX_FIX_LOOPS} fix attempt(s)`,
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
