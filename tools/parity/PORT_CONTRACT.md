# Maintainer contract

TypeScript under `.claude/skills/sssf/templates/` is the product and the spec. Behavior is pinned by the snapshots and contract tests in `tools/parity/`.

## What must NOT change

- The sqlite DDL (`tracer.ts` SCHEMA and MIGRATIONS), every table, column, and index name.
- Event `type` names and the key set of every `payload`; the `events.jsonl` record shape.
- Envelope key order (schema declaration order), envelope field names, `envelope.json` on disk.
- The session directory layout and every file name under `sessions/<adw_id>/`.
- CLI flag names, positional meaning, exit codes: usage error 2, validation failure 1, phase throw 1, SIGTERM 143, `finish()` 0 or 1.
- Timestamp format (`nowIso`, `+00:00`), `adw_id` and session-id formats.
- The argv of every runtime (the `claude`, `copilot`, `exec` argv tests and `fake_pi` pin them).
- Prompt rendering: the bytes an agent receives.
- The console layout: panels, markup, colors.

## Snapshots

`bun test ./tools/parity/` runs the port against fake agents and compares normalized stdout, exit and stderr, the sqlite dump, `events.jsonl`, every session file, and `git status --porcelain`.

When a run differs:

1. Read the failing diff.
2. Decide whether the new bytes are the behavior you meant.
3. `bun test --update-snapshots` in the same commit as the code.
4. Name the snapshot sections that moved, and why, in the commit body.

Do not update snapshots in a commit that has no intended behavior change.

## Conventions

- TypeScript identifiers are camelCase: `loadConfig`, `commitAll`, `artifactsExist`, `runTests`, `asEnvelope`, `run.adwId`. Gate runtime names stay snake_case (`artifactsExist.name === "artifacts_exist"`) because they land in sqlite. CLI dests stay snake_case (`args.adw_id` from `--adw-id`). Field names that hit sqlite, JSON, prompts, or payloads stay snake_case.
- Zero npm dependencies in stamped code. Bun and Node builtins only. No stamped `package.json` or `tsconfig.json`.
- `compat/` owns parsing and rendering: CLI, schema validation, subprocess helpers, console markup. `shell.ts` is the one file there that imports `isDict` from `utils.ts`.
- Trace, envelope, and handoff bytes are `JSON.stringify`.
- `coding_agent` is an open string validated against `agents.INTERFACES`.
- Runtime files export `INTERFACE` and never import `agents.ts`, `runner.ts`, or another runtime's file.
- `makeAdw` emits `return run.finish()` because `run.succeeded` is a compile error.
- `protected_files` glob is `adws/adw_*.ts`.
- A comment stays only for a non-obvious why.
- `claude_code` is pinned by the `fake_claude` cases in `tools/parity/claude.test.ts`.
- `copilot` is pinned by the `fake_copilot` cases in `tools/parity/copilot.test.ts`.
- `exec` is pinned by the `fake_exec` cases in `tools/parity/exec.test.ts`.

## Maintainer checks

`bun run lint` and `bun run typecheck` live at the repo root. They are not stamped into host repos. Tests never run a real coding agent. Set `COPILOT_HOME` to a temp dir wherever the Copilot runtime runs.

## Known bugs

See `.claude/skills/sssf/design/KNOWN_ISSUES.md`. They are not protected. Fixing one is a deliberate change with a snapshot update.

## Layout

The harness is `tools/parity/`. Write the product into `.claude/skills/sssf/templates/adws/`.
