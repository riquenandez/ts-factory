# Update Modules

Extend `adws/adw_modules/` with new low-level logic.

## The rule

**ALL low-level logic lives in `adw_modules/`; ADW scripts stay thin.** An `adw_*.ts` file declares agents, sequences phases, and returns an exit code. Anything else — subprocess handling, parsing, retry mechanics, git plumbing, reusable predicates — goes in a module.

## Where things go

| Module | Owns |
|---|---|
| `data_types.ts` | Every output type: `AgentCall`, `PhaseParams`, `Phase`, `EnvelopeBase` + one output type per agent call, the config models (`AgentConfig`, `SSSFConfig`), `EventRecord`, and `PiRequest`/`PiResult` |
| `agents.ts` | `loadConfig`, `validate`, resolving an entry → coding-agent interface + model + thinking + harness extensions |
| `runner.ts` | the `Run` object; `run.phase(params, body)` callback; `ph.call()` on agent phases |
| `agent_pi.ts` | the Pi interface (v1) — non-interactive `pi -p --mode json`, JSONL stream tailed live, model resolved against `~/.pi/agent/models.json`; `--session-id` creates-or-continues, so running and continuing an agent are the same call |
| `agent_cc.ts` | the Claude Code interface — stubbed in v1, lands in v2 |
| `gates.ts` | validation gates over envelope claims |
| `changes.ts` | deterministic change capture: resolve the base ref, `git diff` into `context_handoff/changes.diff`, adapt the `ChangeSet` into an envelope an agent can be handed |
| `prompts.ts` | load system/user prompt refs from config, render placeholders |
| `session.ts` | mint or join `adwId`, maintain `agent_map.json`, create session dirs incl. `context_handoff/` |
| `tracer.ts` | append JSONL **and** insert every event into `sssf.db` as it happens |
| `console.ts` | the terminal narrative — every line printed also lands in the db as a `log` event, so the UI reads the same story; plain sequential lines, no spinners |
| `git_helper.ts` | branch, status, diff, commit — the raw plumbing `changes.ts` composes. Import it as `gitHelper`. |
| `utils.ts` | safe subprocess env, logging, `resolvePrompt` |

## Never `console.log`

Modules report through `run.console` — never a bare `console.log`. Each console method prints a rich line **and** writes it to `sssf.db` as a `log` event with payload `{message, level}`, both from one `_emit` helper, so the terminal narrative and the swim-lane UI can't drift. New output means a new method on `Console`, not a print at the call site.

## The four-param rule

**Any function taking more than 4 parameters gets them converted into a concrete data type in `data_types.ts`.** `AgentCall` and `PhaseParams` are the pattern — `run.phase()` and `ph.call()` each take exactly one object. This is skill-wide: every module the factory generates obeys it.

```ts
interface ReviewParams {
  /** Everything reviewChanges() needs. Passed as one object, never loose params. */
  baseRef: string;
  paths: string[];
  maxDiffLines: number;
  ignoreGenerated: boolean;
  reviewer: string;
}

function reviewParams(partial: Partial<ReviewParams> & Pick<ReviewParams, "baseRef" | "paths">): ReviewParams {
  return {
    maxDiffLines: 2000,
    ignoreGenerated: true,
    reviewer: "scout",
    ...partial,
  };
}
```

JSON, sqlite, YAML, and prompt fields stay snake_case even when the TypeScript around them is camelCase. A new in-memory helper can use `baseRef`; a field that lands in an envelope or a `## Report` example cannot.

## Adding an output type

Every agent call parses against a concrete type. Extend `EnvelopeBase` — `status`, `summary`, `artifacts`, `notes_for_next_agent` — with only the fields that call actually needs:

```ts
export interface ReviewOutput extends EnvelopeBase {
  approved: boolean;
  blocking: string[];
}
export const ReviewOutput = envelopeType<ReviewOutput>("ReviewOutput", [
  { name: "approved", kind: "bool", default: false },
  { name: "blocking", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
]);
```

Schema `name:` strings are the JSON keys the agent must emit. They stay snake_case (`notes_for_next_agent`, `commit_message`). The TypeScript property names match those keys so parse/dump do not need a second mapping.

**The output contract is a synced triad — one change means three edits, always together:**

1. The type in `data_types.ts` (the enforcer).
2. The agent's `user.md` `## Report` section showing exactly that JSON (the ask).
3. Every call site passing `outputType:` (the binding) — `grep -rn "ReviewOutput" adws/` to find them all.

If the type and the Report example drift, the agent produces what the prompt asked for, the parser rejects what the type expects, and every call burns correction round-trips before landing — a slow, silent tax. Renaming or removing a field is the same triad edit. Schema details: `references/handoff.md`.

## Adding a gate

A gate is a callable — `gate(envelope, run) => GateReport`. You record **one check per item you look at**, and the harness derives the verdict: any failed check is a violation, and no failed checks means pass.

```ts
import { GateReport, type EnvelopeBase } from "./data_types.ts";

export function testsDeclaredPassed(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  const rec = envelope as EnvelopeBase & { failures?: Array<{ test: string; error: string }>; passed?: boolean };
  for (const f of rec.failures ?? []) {
    report.check(f.test, false, f.error);
  }
  const passed = Boolean(rec.passed);
  report.check(
    "suite",
    passed,
    passed ? "all declared tests passed" : `${(rec.failures ?? []).length} declared failure(s)`,
  );
  return report;
}
Object.defineProperty(testsDeclaredPassed, "name", { value: "tests_declared_passed" });
```

Pin `.name` to snake_case. That string is what `gate_results.gate` and the console store. `report.check(item, ok, note)` appends and returns the report, so a single-item gate is one line: `return new GateReport().check(command, ok, \`exit ${code}\`)`.

**Write a note on passing checks too, not just failures.** The note is the evidence, and it is what makes a green gate worth reading — `artifacts_exist ✓ 1 checked · plan.md — exists, 454B` tells you what was verified, where a bare ✓ tells you nothing. Notes on failed checks double as the reason and are what the agent is told, so phrase them as the problem: `"claimed changed file does not exist"`.

Rules that keep gates honest:

- **Verify claims, never predict.** File names and counts are unknowable before the agent finishes; gates check what the envelope declared.
- **Quantity as properties, not counts.** "at least one artifact", "ALL declared paths exist" — never `envelope.artifacts.length === 3`.
- **Record checks, don't throw.** The harness feeds the derived violations back into the same session as a correction — context intact, bounded by the phase's `retries` — and traces every check, passed or failed, to `gate_results.checks_json` and the `gate_pass`/`gate_fail` event payload.
- **Check every item, even after one fails.** Don't early-return on the first problem; the agent fixes more per correction round when it sees every failure at once, and the trace shows the full picture.
- **Don't gate the ungateable.** Plan quality and code taste are a reviewer agent's job or a human's.

A gate that returns a plain `string[]` of violations still works — the harness adapts it — but it records no evidence for the items that passed, so prefer a `GateReport`.

Reusable gates live in `gates.ts`; genuine one-offs can be defined inline at the ADW call site and passed in `gates: [...]`.

## Before you finish

Run the smoke ADW — `bun adws/adw_prompt.ts "ping"` — since every module change rides the same path a real run does.
