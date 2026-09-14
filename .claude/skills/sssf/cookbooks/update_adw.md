# Update ADW

Modify an existing chain: add or remove phases, add gates, add a bounded fix loop.

## Add a phase

Insert an `await run.phase({...}, async (ph) => { ... })` where it belongs. If it names an agent not in `REQUIRED_AGENTS`, add it there, or validation passes and the run dies mid-flight.

```ts
const found = await run.phase({
  name: "scout",
  kind: "agent",
  owner: "scout",
  description: "Locate the code the request touches before anyone plans",
}, async (ph) => {
  return await ph.call({ outputType: ScoutOutput, prompt }) as ScoutOutput;
});
```

`name` is unique within the run. `description` says what and why; `validatePhaseParams` rejects a blank or a restatement of the name. A code phase does its work in the callback and logs it with `ph.log({...})`; the commit phase in `adws/adw_plan_build.ts` is the pattern.

## Remove a phase

Delete the call, drop any now-unused agent from `REQUIRED_AGENTS`, and re-thread `previous:` on whatever consumed the removed phase's envelope.

## Add gates

```ts
gates: [gates.artifactsExist, gates.diffMatchesClaims],
```

A gate is `gate(envelope, run) => GateReport` with one `check(item, ok, note)` per thing examined. Violations go back into the same session as a correction, bounded by the phase's `retries`; exhausting them throws `GateFailure`. Every result lands in `gate_results`. Gate claims the envelope makes, never predictions, and never hardcode counts. New reusable gates go in `gates.ts` (`update_modules.md`).

The function is `gates.artifactsExist`; its runtime name written to sqlite stays `artifacts_exist`. Do not rename runtime names.

## Add a bounded fix loop

From `adws/adw_build_test.ts`. The runner is a code phase; only the repair needs an agent.

```ts
const MAX_FIX_LOOPS = 3;

let test: QualityResult | null = null;
for (let i = 1; i <= MAX_FIX_LOOPS; i++) {
  test = await run.phase({
    name: `test_${i}`,
    kind: "code",
    owner: "quality",
    description: "Run the suite; a known command, so code runs it",
  }, async (ph) => {
    const result = quality.runTests(run);
    ph.log({ passed: result.passed, artifacts: result.artifacts.join(", ") });
    return result;
  });
  if (test.passed) break;

  await run.phase({
    name: `fix_${i}`,
    kind: "agent",
    owner: "builder",
    retries: 1,
    description: "Repair what the suite reported, from its verbatim output",
  }, async (ph) => {
    return await ph.call({
      outputType: BuildOutput,
      prompt,
      previous: quality.asEnvelope(test, "tests"),
      gates: [gates.diffMatchesClaims],
    }) as BuildOutput;
  });
}

return run.finish({
  accepted: test !== null && test.passed,
  reason: `the suite still failed after ${MAX_FIX_LOOPS} fix attempt(s)`,
});
```

Wire the real command in `quality.ts` first; the stamped blocks are `echo` placeholders that exit 0.

Three things to keep straight:

- **JSON retries vs gate retries.** Malformed JSON is always re-prompted up to `JSON_FIX_ATTEMPTS` (2) regardless of `retries`. `retries` only buys gate-correction rounds.
- **Phase retries vs fix loops.** `retries` re-attempts one agent phase in the same session. A fix loop repeats a chain of phases with new envelopes each pass.
- **A test phase that ran a red suite succeeded.** The runner did its job. The run fails at `run.finish({ accepted })`.

## Keep scripts thin

Sequencing and acceptance only. Anything else belongs in `adw_modules/` (`update_modules.md`).
