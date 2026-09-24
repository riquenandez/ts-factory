#!/usr/bin/env bun
const DOC = `ADW Plan Build — two-agent chain: planner -> envelope -> builder.

Phases: engineer(request) -> planner -> builder -> git(commit)
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as gitHelper from "./adw_modules/gitHelper.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { BuildOutput, PlanOutput } from "./adw_modules/dataTypes.ts";

const REQUIRED_AGENTS = ["planner", "builder"];

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

  const build = await run.phase({
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

  await run.phase({
    name: "commit",
    kind: "code",
    owner: "git",
    description: "Land the builder's changes, using the message it wrote",
  }, async (ph) => {
    const message = build.commit_message || `sssf(${run.adwId}): ${build.summary}`;
    ph.log({ sha: gitHelper.commitAll(message), message });
  });

  return run.finish();
});
