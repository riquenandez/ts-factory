#!/usr/bin/env bun
const DOC = `ADW Quality — lint, typecheck, and build the project.

Usage:
    bun adws/adw_quality.ts "<reason for the quality run>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> code(quality)
`;

import * as agents from "./adw_modules/agents.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import * as utils from "./adw_modules/utils.ts";
import { parseArgs, runMain } from "./adw_modules/compat/cli.ts";
import { RuntimeError } from "./adw_modules/utils.ts";

const REQUIRED_AGENTS: string[] = [];

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
    description: "Capture why quality verification was requested",
  }, async (ph) => {
    ph.log({ input: prompt });
  });

  await run.phase({
    name: "quality",
    kind: "code",
    owner: "quality",
    description: "Run the deterministic quality blocks",
  }, async (ph) => {
    const result = quality.runQuality(run);
    const passed = result.checks.filter((check) => check.passed).length;
    ph.log({
      passed: result.passed,
      checks: `${passed}/${result.checks.length}`,
      artifacts: result.artifacts.join(", "),
    });
    if (!result.passed) {
      throw new RuntimeError("quality failed: " + result.failures.join("; "));
    }
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
