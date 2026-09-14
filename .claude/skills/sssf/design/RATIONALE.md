# TypeScript port of Super Simple Software Factory

## Problem

Port the factory from Python to TypeScript with zero behaviour drift. The Python under `templates/` is the spec: same just recipes, flags, exit codes, sqlite the existing visualizer already polls, Pi argv, session layout, nested retries, stamp-into-cwd install. The hard part is that the Python *runtime* is part of the contract (`+00:00` timestamps, two disagreeing JSON encoders, pydantic error prose, `True`/`False` on the console). Docs that disagree with code lose. Known bugs stay bugs.

## Usage (caller's view)

See [`USAGE.md`](USAGE.md). Four calls: `agents.loadConfig` / `agents.validate` → `session.ensure` → `run.phase(params, body)` → `run.finish`. `ph.call` only on agent phases. ADW scripts stay thin; loop shapes A and B stay in separate files. Interpreter is `bun adws/adw_*.ts` where Python used `uv run adws/adw_*.py`.

## Shape

Stamped host engine, Bun, **zero npm dependencies**. `adws/adw_modules/` is a module-for-module port of the Python modules (camelCase file names) plus a `compat/` ring that owns every Python-runtime observable (json, format, schema, markup, shell, cli, yaml). Field names that hit sqlite/JSON/prompts stay snake_case. Public ADW functions are camelCase (`loadConfig`, `runTests`, `artifactsExist`, `commitAll`).

`run.phase(params, body)` is a callback that returns the body's value and observes throws (the only TS shape that preserves "success must be earned"). Overloads give agent phases an `AgentPhaseHandle` with `call`; other kinds do not. Three finalization doors stay separate: throw, `finish()`, SIGTERM/SIGINT. `execute` always calls Pi. Permission `enforce` stays on the happy path. `tools: []` omits `--tools`. Cwd split stays split.

Envelopes are branded plain objects (`Envelope<F>`) so `previous.commit_message` reads like Python while the engine re-serializes in declaration order. Schemas at the two trust boundaries (agent JSON, config YAML); plain records inside.

Parity is structural: `tools/parity/` runs Python gold and TS against `fake_pi`, with negative tests that fail if a preserved bug is "fixed".

## Synthesis decision

**Base: Opus** ([Architect sketch Opus](c809d7c5-b279-4ee7-a136-d67149b53647)). Cross-judge ([Cross-judge design sketches](b42bb12d-4f94-4964-a94f-9a7ec2911f73)) and parent agreed: treating the Python runtime as an observable contract, with a single-owner `compat/` map and a differential harness, is the only shape that makes "no drift" extendable instead of a review checklist.

**Grafted from Fable** ([Architect sketch Fable](6652e578-1f1d-4b12-a890-f3f38f8907c6)): discriminated `AgentPhaseHandle` so `ph.call` is a type error outside agent phases; `parseArgs` reads the file's leading `/** */` the way argparse read `__doc__`; public ADW identifiers are camelCase (`loadConfig`, `adwId`, `repoRoot`).

**Grafted from Grok** ([Architect sketch Grok](86f08d66-93b5-4e9a-92a6-e511441578d9)): distinct `ParseAttempt` / `GateAttempt` aliases so the three `attempt` columns are not conflated internally.

**Grafted from GPT** ([Architect sketch GPT](69208d0c-47b5-46ce-bc16-90d90d02b6e7)): nothing on the public surface. Required-agent owner inference is a compile-time extra the Python does not have; skipped to avoid rejecting a custom ADW the Python would run.

**Rejected from losers:** GPT's camelCase cookbook surface, combined `ensure`, async quality, and pre-migrated fresh SCHEMA. Grok's Zod + stamped `package.json` / `node_modules`. Fable's accepted byte/prose drift and barrel that re-exports `tracer` / `agentPi`. Opus's stamped `tsconfig.json` (install stays a file copy of the Python dest list, plus `.ts` for `.py`).

**Isomorphic translations (not cleanups):** `protected_files` glob `adws/adw_*.py` → `adws/adw_*.ts` because the scripts *are* `.ts`. `makeAdw` emits `return run.finish()` because `run.succeeded` is a *compile* error in TS (a new failure mode); the Python generator is already stale against SKILL.md rule 10. Drop `__pycache__/` / `*.pyc` from the TS gitignore list; add nothing about `node_modules` because there is no package install.

## Tradeoffs accepted

- We accept a `compat/` layer in exchange for controlling sqlite, stdout, and prompt bytes.
- We accept callback `phase` in exchange for an un-forgettable failure path.
- We accept shipping known bugs (permission skip, `tools: []`, quality `operation="build"`, `ok`-less quality tool_call) pinned by negative parity cases.
- We accept snake_case on the ADW surface against TS convention in exchange for cookbook-identical call sites and sqlite gate names.
- We accept `processes.command` recording `adw_x.ts` rather than `.py`.

## Alternatives considered

- **Engine as a published package.** Rejected: `update_modules.md` edits `adw_modules/`; `protected_files` defends that path; install would gain a package step.
- **Declarative phase manifest.** Rejected: the twelve ADWs differ in control flow, not configuration.
- **Zod + stamped package.json.** Rejected: pydantic error prose and key order are observables; install would no longer be a file copy.

## Open questions and risks

- Is byte-identical *coloured* stdout in scope, or is the plain (piped) form plus identical `log` payloads enough?
- Does `Bun.YAML.parse` match `yaml.safe_load` on empty docs, or do we vendor `compat/yaml.ts`?
- Bun auto-loads `.env.local`; Python `load_dotenv()` reads only `.env`. Accept, or warn at install?

## Next implementation step

Build `compat/` (`now_iso`, `new_id`, both JSON encoders, `py_str` / `py_slice`) and `tracer.ts` against a fixture dump, then `session.ensure` + `Run.phase` with no agent.
