# Update Modules

Extend `adws/adw_modules/`. All low-level logic lives here; ADW scripts declare agents, sequence phases, and return an exit code.

## Where things go

| Module | Owns |
|---|---|
| `dataTypes.ts` | `PhaseParams`, `AgentCall`, `EnvelopeBase`, one output type per agent call, config models, `EventRecord`, `AgentRequest`/`AgentResult` |
| `agents.ts` | `loadConfig`, `validate`, running an agent call: JSON retries, gates, permissions |
| `runner.ts` | `Run`, `run.phase()`, `ph.call()`, `run.finish()` |
| `agentPi.ts` | the pi interface: argv, live JSONL tail, model resolution. `agentCc.ts` is a v2 stub |
| `toolCalls.ts` | `labelFor`, `clip`, `textOf`: the one tool-call record shape every runtime emits |
| `gates.ts` | claim verifiers |
| `quality.ts` | lint, typecheck, build, test blocks; `asEnvelope` |
| `changes.ts` | git diff capture into `context_handoff/changes.diff`; `asEnvelope` |
| `permissions.ts` | before/after repo fingerprint, rollback, `writes` and `protected_files` enforcement |
| `prompts.ts`, `session.ts`, `tracer.ts`, `console.ts`, `gitHelper.ts`, `utils.ts` | rendering, session dirs and `agent_map.json`, the trace, the narrative, git plumbing, ids and env |
| `compat/` | the parsers and renderers the engine owns: CLI, schema validation, subprocess helpers, console markup |

## Rules

- **Never `console.log`.** Report through `run.console`. Every method prints and writes a `log` event, so terminal and UI cannot drift. New output is a new `Console` method.
- **Four-param rule.** More than four parameters becomes one object typed in `dataTypes.ts`; `AgentCall` and `PhaseParams` are the pattern.
- **Naming.** TypeScript identifiers are camelCase. Anything that reaches sqlite, JSON, YAML, or a `## Report` example stays snake_case.
- **Trace, envelope, and handoff bytes are `JSON.stringify`.** The snapshot tests in `tests/` pin them.

## Add an output type

Extend `EnvelopeBase` with only the fields that call needs. Schema `name:` strings are the JSON keys the agent emits, and the property names match them.

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

The output contract is a synced triad (SKILL.md rule 2): the type, the agent's `## Report` example, and every `outputType:` call site. `grep -rn ReviewOutput adws/` finds the call sites. Drift costs correction rounds on every call.

## Add a gate

A gate records one `check(item, ok, note)` per thing it looks at; the harness derives the verdict.

```ts
import { GateReport, type EnvelopeBase } from "./dataTypes.ts";

export function testsDeclaredPassed(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  const rec = envelope as EnvelopeBase & { failures?: Array<{ test: string; error: string }>; passed?: boolean };
  for (const f of rec.failures ?? []) report.check(f.test, false, f.error);
  const passed = Boolean(rec.passed);
  report.check("suite", passed, passed ? "all declared tests passed" : `${(rec.failures ?? []).length} declared failure(s)`);
  return report;
}
Object.defineProperty(testsDeclaredPassed, "name", { value: "tests_declared_passed" });
```

- Pin `.name` to snake_case; that string lands in `gate_results.gate`.
- Write a note on passing checks too. The note is the evidence a green gate shows.
- Verify claims, never predict. Express quantity as a property ("at least one artifact"), never a count.
- Check every item even after one fails, so the agent fixes more per correction round.
- Do not gate plan quality or code taste. That is the reviewer's job.

Reusable gates go in `gates.ts`; one-offs can be inline at the call site.

## Add a coding-agent runtime

A new runtime is four steps. Nothing else in the core changes.

1. Add one file in `adw_modules/` that exports `INTERFACE: AgentInterface` (`run`, `newTracker`, `mintSessionId`, `validate`, `sessionDirName`).
2. Register it with one line in `agents.INTERFACES`.
3. Add a `fake_<name>` fixture and `<name>.test.ts` mirroring `fake_copilot` / `copilot.test.ts`.
4. Document the name on the `coding_agent` row and any runtime-specific rows in `references/config.md`.

Runtime files import `dataTypes.ts`, `toolCalls.ts`, `compat/*`, and `utils.ts` only, never `agents.ts` or `runner.ts`.

An agent that lives in another repo does not need a runtime file at all: it needs a command that speaks [references/exec-protocol.md](../references/exec-protocol.md), registered as `coding_agent: exec` with a `command` argv list.

## Before you finish

`bun adws/adw_prompt.ts "ping" --agent scout`. Every module change rides the same path a real run does.
