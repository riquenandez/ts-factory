#!/usr/bin/env bun
const DOC = `ADW Prompt — the smallest ADW: one agent, one prompt, traced end-to-end.

Phases: engineer(request) -> <agent>
`;

import * as agents from "./adw_modules/agents.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { GenericOutput } from "./adw_modules/dataTypes.ts";

await adw(DOC, async ({ cfg, prompt, adwId, args }) => {
  const agent = args.agent ?? "builder";
  const REQUIRED_AGENTS = [agent];
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt);

  await run.phase({
    name: "prompt",
    kind: "agent",
    owner: agent,
    description: `Send the request straight to ${agent} and parse its envelope`,
  }, async (ph) => {
    await ph.call({ outputType: GenericOutput, prompt });
  });

  return run.finish();
}, [
  { name: "--agent", default: "builder", help: "agent name from the config" },
]);
