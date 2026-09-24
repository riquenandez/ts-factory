#!/usr/bin/env bun
const DOC = `ADW Scout — read-only recon workflow. Just looking for stuff.

Phases: engineer(request) -> scout
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { ScoutOutput } from "./adw_modules/dataTypes.ts";

const REQUIRED_AGENTS = ["scout"];

await adw(DOC, async ({ cfg, prompt, adwId }) => {
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt);

  await run.phase({
    name: "scout",
    kind: "agent",
    owner: "scout",
    description: "Find and report where things live — change nothing",
  }, async (ph) => {
    await ph.call({
      outputType: ScoutOutput,
      prompt,
      gates: [gates.artifactsExist],
    });
  });

  return run.finish();
});
