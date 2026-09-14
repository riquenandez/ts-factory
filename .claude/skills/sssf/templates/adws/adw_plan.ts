#!/usr/bin/env bun
const DOC = `ADW Plan — one-shot planning workflow.

Usage:
    bun adws/adw_plan.ts "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> planner
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as session from "./adw_modules/session.ts";
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/compat/cli.ts";
import { PlanOutput } from "./adw_modules/data_types.ts";

const REQUIRED_AGENTS = ["planner"];

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

  await run.phase({
    name: "plan",
    kind: "agent",
    owner: "planner",
    description: "Turn the request into an implementable plan",
  }, async (ph) => {
    await ph.call({
      outputType: PlanOutput,
      prompt,
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
      { name: "--config", default: "adws/adw_sssf_config/sssf.config.yaml" },
      { name: "--adw-id", default: null, help: "join or pin an existing session" },
    ],
  });
  return main(utils.resolvePrompt(args.prompt!), args.config!, args.adw_id);
});
