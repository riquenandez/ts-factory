# Module map

This repo keeps the engine at `.claude/skills/sssf/templates/adws/`.
`install.ts` stamps it to `adws/` in a host repo.
Every path below is relative to `adws/`.

The twelve `adw_*.ts` scripts sit beside `adw_modules/`. They declare agents, sequence phases, and return `run.finish()`.

## Files

| File | Owns |
|---|---|
| `adw_modules/agentCc.ts` | `claude_code` argv, stream-json tail, `ClaudeToolCallTracker`, `INTERFACE` |
| `adw_modules/agentCopilot.ts` | copilot argv, JSONL tail, `CopilotToolCallTracker`, `INTERFACE` |
| `adw_modules/agentExec.ts` | exec runtime: spawn `command` speaking `sssf-exec/1`, `INTERFACE` |
| `adw_modules/agentPi.ts` | pi argv, JSONL tail, model resolution, `ToolCallTracker`, `INTERFACE` |
| `adw_modules/agents.ts` | `loadConfig`, `validate`, `resolve`, `execute`, `INTERFACES`, JSON retries, gates, permissions |
| `adw_modules/changes.ts` | git diff capture into a `ChangeSet`, `asEnvelope` |
| `adw_modules/console.ts` | the narrative: print and trace together |
| `adw_modules/dataTypes.ts` | envelopes, config interfaces and the schemas under them, engine records, `AgentRequest` / `AgentResult`, `AgentInterface` |
| `adw_modules/gates.ts` | claim verifiers |
| `adw_modules/gitHelper.ts` | low-level git |
| `adw_modules/permissions.ts` | git-fingerprint audit: snapshot, enforce, rollback |
| `adw_modules/prompts.ts` | render `{{placeholders}}` and save the audit copy |
| `adw_modules/quality.ts` | lint, typecheck, build, test blocks; `asEnvelope` |
| `adw_modules/runner.ts` | `Run`, `PhaseHandle`, `AgentPhaseHandle`, `phase()`, `finish()`, `validatePhaseParams` |
| `adw_modules/session.ts` | `ensure()`: pin or create `adw_id`, build `Run`, install signal doors |
| `adw_modules/toolCalls.ts` | `labelFor`, `clip`, `textOf`: the one tool-call record shape every runtime emits |
| `adw_modules/tracer.ts` | `SCHEMA`, `MIGRATIONS`, every INSERT/UPDATE, JSONL append |
| `adw_modules/utils.ts` | ids, timestamps, prompt resolution, engineer name, cleanup hooks, `isDict`, `RuntimeError` (the ADW scripts throw it) |
| `adw_modules/compat/cli.ts` | CLI parsing on `node:util` `parseArgs`: help, `error:` lines, exit 2, `ExitError` |
| `adw_modules/compat/markup.ts` | markup to `(ansi, plain)`, `escape()`, `panel` |
| `adw_modules/compat/schema.ts` | declarative schemas: ordered fields, defaults, extra ignored, plain validation errors, `modelDump` |
| `adw_modules/compat/shell.ts` | `spawnCaptured`, `spawnShell`, `spawnJsonl`, `shlexJoin`, `operatorEnv` |

There is no barrel. `spawnJsonl` is the one stdout tail: spawn, drain stderr, append every chunk to `raw_output.jsonl`, parse each JSON object, map a signal to a negative return code.

## Import rules

A runtime file (`agentPi.ts`, `agentCc.ts`, `agentCopilot.ts`, `agentExec.ts`) imports Node builtins, `dataTypes.ts`, `toolCalls.ts`, `compat/*`, and `utils.ts`. It does not import `agents.ts`, `runner.ts`, or another runtime. `registry.test.ts` pins that with "runtime files are self-contained".

Nothing under `compat/` imports outside `compat/` except `shell.ts`, which imports `isDict` from `utils.ts`. Node builtins are the other imports. `registry.test.ts` pins that.

Factory modules import the `compat/` file that owns the concern (`spawnCaptured` from `shell.ts`). They do not re-export it. Trace, envelope, and handoff bytes are `JSON.stringify`.

## Naming rule

**Field names are wire. Method names are code. File names are camelCase.**

Anything that reaches sqlite, JSONL, a prompt, or a `payload` keeps its snake_case spelling: `adw_id`, `payload_json`, `notes_for_next_agent`, `changed_files`, `output_type`, `phase_id`, `started_at`, `timeout_seconds`, `poll_ms`, `protected_files`. Renaming any of them breaks the visualizer or a `## Report` example.

Functions and methods take TypeScript's idiom: `loadConfig`, `sessionFinish`, `phaseUpsert`, `runQuality`, `asEnvelope`. `run.adwId` is a method-side property (never serialized directly) — the tracer writes `adw_id` columns from it.

Two deliberate exceptions where the identifier *is* the contract the engineer reads: `gates.artifactsExist` (exported camelCase; `.name` is pinned to `artifacts_exist` so `gate_results.gate` does not drift) and `AgentCall.outputType` (the call-site key; the JSON field the agent emits is still the schema's snake_case `name:`).

A coding-agent runtime is one file in `adw_modules/` that exports `INTERFACE: AgentInterface` (`run`, `newTracker`, `mintSessionId`, `validate`, `sessionDirName`) plus one line in `agents.INTERFACES`. Runtime files import Node builtins, `dataTypes.ts`, `toolCalls.ts`, `compat/*`, and `utils.ts` only, never `agents.ts`, `runner.ts`, or another runtime.

## Public surface

An ADW script reaches for these.

| Call | From | Returns |
|---|---|---|
| `agents.loadConfig(path?)` | `agents.ts` | `SSSFConfig` |
| `agents.validate(cfg, required)` | `agents.ts` | `void`, or throws `ExitError` |
| `session.ensure(cfg, adwId?)` | `session.ts` | `Run` |
| `run.phase(params, body)` | `runner.ts` | `Promise<T>`. `kind: "agent"` passes an `AgentPhaseHandle`; `"engineer"` and `"code"` pass a `PhaseHandle` |
| `ph.log(payload)` | `PhaseHandle` | `void` |
| `ph.call(agentCall)` | `AgentPhaseHandle` only | `Promise<T>` parsed by `outputType` |
| `run.finish({ accepted?, reason? })` | `Run` | `number`, the exit code |
| `run.engineer` / `run.adwId` / `run.repoRoot` | `Run` | `string` |
| `gates.*`, `quality.*`, `changes.*`, `gitHelper.*`, `utils.resolvePrompt`, `cli.parseArgs`, `cli.runMain` | those modules | what each function returns |
| output types (`GenericOutput`, `PlanOutput`, `BuildOutput`, …) | `dataTypes.ts` | the value `ph.call` parses |
| `INTERFACE` | `agentPi.ts`, `agentCc.ts`, `agentCopilot.ts`, `agentExec.ts` | `AgentInterface`. One line in `agents.INTERFACES` registers it. This is the seam a new runtime implements |

`PhaseHandle` has `log` only. `call` is not on it. ADW scripts do not import `tracer.ts` or `console.ts`. `Run` still holds both, and `execute` writes through them.

## Tracing a flow

| Flow | Files |
|---|---|
| an agent phase, prompt to envelope | `adw_*.ts` → `runner.ts` → `agents.ts` |
| what a runtime was asked | `agents.ts` → `agentPi.ts` / `agentCc.ts` / `agentCopilot.ts` / `agentExec.ts` (`spawnJsonl` in `compat/shell.ts`) |
| what reached the UI | `runner.ts` / `agents.ts` → `tracer.ts` |
| what reached the terminal | caller → `console.ts` → `compat/markup.ts` |
| a permission breach | `agents.ts` → `permissions.ts` |
| a code phase's verdict | `adw_*.ts` phase body → `quality.ts` |

`loadConfig` and `validate` run before `session.ensure`, so they do not pass through `runner.ts`. Every phase does.

## Who writes what

| Writer | Writes | Conflict rule |
|---|---|---|
| ADW process `Tracer` | `sessions`, `phases`, `events`, `envelopes`, `gate_results`, `processes`, `agent_sessions`, and `events.jsonl` | WAL + `busy_timeout=5000`. Phases upsert on `phase_id`. `agent_sessions` upserts on `(adw_id, agent)`. `sessions.total_tokens` and `total_cost` accumulate in SQL (`SET x = x + ?`) |
| ADW process `Run` | `sessions/{adw_id}/agent_map.json` | whole-file rewrite from the in-memory map read at construction. Two processes on the same `adw_id` at the same time clobber each other. A known limitation; deliberately not fixed |
| visualizer | `sessions.archived`, one column, its own connection | human-triggered. A rejoined run clears it: `sessionStart` sets `archived=0` |

The visualizer's `agentsFor()` unions finished `agent_sessions` rows with in-flight `agent_start` events and lets the finished row win. Every run owns `sessions/{adw_id}/`. Every agent owns `sessions/{adw_id}/{agent}/`. The port adds no lock, no queue, and no reconciliation pass.

## Runtime

Bun, for four reasons that are all contract, not taste:

1. `bun:sqlite` is synchronous, so the tracer writes inside a signal handler and inside a phase transition.
2. `Bun.spawnSync` (`spawnCaptured`) gives blocking git, quality, gate, and permission subprocesses, so those modules stay synchronous. Async coloring is confined to `ph.call()`.
3. `Bun.spawn` (`spawnJsonl`) streams a runtime's stdout while it works. All four runtimes share that loop.
4. The visualizer is already Bun, and `just obs` is unchanged.

`.env` is loaded by Bun at startup. It does not override a real environment variable.
