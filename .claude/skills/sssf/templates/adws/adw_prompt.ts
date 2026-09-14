#!/usr/bin/env bun
const DOC = `ADW Prompt — the smallest ADW: one agent, one prompt, traced end-to-end.

Usage:
    bun adws/adw_prompt.ts "<prompt or path/to/prompt.md>" [--agent builder] [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> <agent>
`;

import * as agents from "./adw_modules/agents.ts";
import * as session from "./adw_modules/session.ts";
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/compat/cli.ts";
import { GenericOutput } from "./adw_modules/data_types.ts";

async function main(
  prompt: string,
  agent: string = "builder",
  config: string = "adws/adw_sssf_config/sssf.config.yaml",
  adwId: string | null = null,
): Promise<number> {
  const cfg = agents.loadConfig(config);
  agents.validate(cfg, [agent]);
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
    name: "prompt",
    kind: "agent",
    owner: agent,
    description: `Send the request straight to ${agent} and parse its envelope`,
  }, async (ph) => {
    await ph.call({ outputType: GenericOutput, prompt });
  });

  return run.finish();
}

await runMain(async () => {
  const args = parseArgs({
    description: DOC,
    positional: [{ name: "prompt", help: "inline text or a path to a prompt file" }],
    options: [
      { name: "--agent", default: "builder", help: "agent name from the config" },
      { name: "--config", default: "adws/adw_sssf_config/sssf.config.yaml" },
      { name: "--adw-id", default: null, help: "join or pin an existing session" },
    ],
  });
  return main(utils.resolvePrompt(args.prompt!), args.agent!, args.config!, args.adw_id);
});
