# TypeScript port of Super Simple Software Factory

## Problem

The port is done. The TypeScript is the product and the spec. The Python original is at tag `python-gold-final` for archaeology. Docs that disagree with code lose. Known bugs stay bugs until a snapshot update says otherwise.

## Usage (caller's view)

See [README.md](../../../README.md) and [cookbooks/create_adw.md](../cookbooks/create_adw.md). Four calls: `agents.loadConfig` / `agents.validate` → `session.ensure` → `run.phase(params, body)` → `run.finish`. `ph.call` only on agent phases. ADW scripts stay thin; loop shapes A and B stay in separate files. Interpreter is `bun adws/adw_*.ts`.

## Shape

Stamped host engine, Bun, **zero npm dependencies**. `adws/adw_modules/` is the engine (camelCase file names). CLI, schema validation, subprocess helpers, and console markup each live in the file that owns them (`cli.ts`, `schema.ts`, `shell.ts`, `console.ts`). Field names that hit sqlite/JSON/prompts stay snake_case. Public ADW functions are camelCase (`loadConfig`, `runTests`, `artifactsExist`, `commitAll`).

`run.phase(params, body)` is a callback that returns the body's value and observes throws (the only TS shape that preserves "success must be earned"). Overloads give agent phases an `AgentPhaseHandle` with `call`; other kinds do not. Three finalization doors stay separate: throw, `finish()`, SIGTERM/SIGINT. `execute` always calls Pi. Permission `enforce` stays on the happy path. `tools: []` omits `--tools`. Cwd split stays split.

Envelopes are branded plain objects (`Envelope<F>`) so `previous.commit_message` reads as a field while the engine re-serializes in declaration order. Schemas at the two trust boundaries (agent JSON, config YAML); plain records inside.

Behavior is pinned by the snapshots and contract tests in `tests/`. The limitations in [KNOWN_ISSUES.md](KNOWN_ISSUES.md) are not protected.

## Isomorphic translations

`protected_files` glob `adws/adw_*.py` → `adws/adw_*.ts` because the scripts *are* `.ts`. `makeAdw` emits `return run.finish()` because `run.succeeded` is a *compile* error (a new failure mode). Drop `__pycache__/` / `*.pyc` from the TS gitignore list; add nothing about `node_modules` because there is no package install.

## Tradeoffs accepted

- We accept hand-rolled CLI, schema, shell, and markup in exchange for controlling sqlite, stdout, and prompt bytes.
- We accept callback `phase` in exchange for an un-forgettable failure path.
- We accept shipping known bugs (permission skip, `tools: []`, quality `operation="build"`, `ok`-less quality tool_call) pinned by negative parity cases.
- We accept snake_case on the ADW surface against TS convention in exchange for cookbook-identical call sites and sqlite gate names.
- We accept `processes.command` recording `adw_x.ts` rather than `.py`.

## Alternatives considered

- **Engine as a published package.** Rejected: `update_modules.md` edits `adw_modules/`; `protected_files` defends that path; install would gain a package step.
- **Declarative phase manifest.** Rejected: the twelve ADWs differ in control flow, not configuration.
- **Zod + stamped package.json.** Rejected: validation error text and key order are observables; install would no longer be a file copy.
