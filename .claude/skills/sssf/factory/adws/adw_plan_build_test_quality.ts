#!/usr/bin/env bun
const DOC = `ADW Plan Build Test Quality — full agent chain plus deterministic quality.

Phases: engineer(request) -> planner -> builder -> [code(verify) -> code(test) -> builder(fix)] bounded -> git(commit)

Verify and test are CODE, not agents. Their commands are known, so running them
needs no judgement — only repairing them does. A failing block does not fail its
phase: the runner did its job, the code is what failed. The failure becomes an
envelope and flows back into the builder, and only an exhausted repair loop
fails the run.
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as gitHelper from "./adw_modules/gitHelper.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { BuildOutput, PlanOutput } from "./adw_modules/dataTypes.ts";
import type { QualityResult } from "./adw_modules/quality.ts";

const REQUIRED_AGENTS = ["planner", "builder"];
const MAX_FIX_LOOPS = 3;

await adw(DOC, async ({ cfg, prompt, adwId }) => {
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt);

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

  let testResult: QualityResult | null = null;
  let qualityResult: QualityResult | null = null;
  for (let i = 1; i <= MAX_FIX_LOOPS; i++) {
    qualityResult = await run.phase({
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
    testResult = qualityResult;

    if (qualityResult.passed && testResult.passed) {
      break;
    }
    if (i === MAX_FIX_LOOPS) {
      break;
    }

    // Whichever block failed becomes the builder's spec — verbatim command
    // output, no parser standing between the failure and the fix.
    const broken = !qualityResult.passed ? qualityResult : testResult;
    const what = !qualityResult.passed ? "verification" : "tests";
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
    qualityResult !== null && qualityResult.passed
    && testResult !== null && testResult.passed
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
});
