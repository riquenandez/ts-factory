# Port contract

The tests under `tools/parity/` pin behavior. TypeScript under `.claude/skills/sssf/templates/` is the product. A change that drifts from those pins is a bug.

## Done

`bun test ./tools/parity/` is green. That includes live-Python oracle tests and `fake_pi` cases that diff gold vs TS.

## Maintainer checks

`bun run lint` and `bun run typecheck` live at the repo root. They are not stamped into host repos.

## Rules

- Module-for-module port, with camelCase file names (`dataTypes.ts` is `data_types.py`, `gitHelper.ts` is `git_helper.py`). Field names that hit sqlite, JSON, prompts, or payloads stay snake_case.
- TypeScript identifiers are camelCase: `loadConfig`, `commitAll`, `artifactsExist`, `runTests`, `asEnvelope`, `run.adwId`. Gate **runtime** names stay snake_case (`artifactsExist.name === "artifacts_exist"`) because they land in sqlite. CLI dests stay argparse-shaped (`args.adw_id` from `--adw-id`).
- Zero npm dependencies in stamped ADWs. Bun APIs only. No stamped `package.json` or `tsconfig.json`.
- `compat/` owns every Python-runtime observable. No file outside `compat/` may call `JSON.stringify` for trace, envelope, or agent_map bytes. Use `pyJson` for `json.dumps` and `serdeJson` for `model_dump_json`.
- Known bugs stay bugs. See `.claude/skills/sssf/design/PARITY.md` section 4. Negative tests must fail if a bug is "fixed".
- `protected_files` glob `adws/adw_*.py` becomes `adws/adw_*.ts` because the scripts are `.ts`. That is the only intentional glob change.
- `makeAdw` emits `return run.finish()` because `run.succeeded` is a compile error.
- Do not add comments that narrate what the Python already stated. A comment stays only for a non-obvious why.
- `claude_code` has no Python gold; its contract is pinned by the `fake_claude` cases in `tools/parity/claude.test.ts`.
- `copilot` has no Python gold; its contract is pinned by the `fake_copilot` cases in `tools/parity/copilot.test.ts`.
- `exec` has no Python gold; its contract is pinned by the `fake_exec` cases in `tools/parity/exec.test.ts`.
- `coding_agent` is an open string validated against `agents.INTERFACES`.
- Runtime files export `INTERFACE` and never import `agents.ts`, `runner.ts`, or another runtime's file.

## Layout

The harness is `tools/parity/`. Write the port into `.claude/skills/sssf/templates/adws/`.
