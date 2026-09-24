#!/usr/bin/env bun
const DOC = `ADW Quality — lint, typecheck, and build the project.

Phases: engineer(request) -> code(quality)
`;

import * as agents from "./adw_modules/agents.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";

const REQUIRED_AGENTS: string[] = [];

await adw(DOC, async ({ cfg, prompt, adwId }) => {
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  await run.request(prompt, "Capture why quality verification was requested");

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
      throw new Error("quality failed: " + result.failures.join("; "));
    }
  });

  return run.finish();
});
