#!/usr/bin/env bun
const DOC = `ADW Build — one-shot implementation workflow.

Phases: engineer(request) -> builder
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { BuildOutput } from "./adw_modules/dataTypes.ts";

const REQUIRED_AGENTS = ["builder"];

await adw(DOC, async ({ cfg, prompt, adwId }) => {
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt);

  await run.phase({
    name: "build",
    kind: "agent",
    owner: "builder",
    retries: 1,
    description: "Implement the request",
  }, async (ph) => {
    await ph.call({
      outputType: BuildOutput,
      prompt,
      gates: [gates.diffMatchesClaims],
    });
  });

  return run.finish();
});
