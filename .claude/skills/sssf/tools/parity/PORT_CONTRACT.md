# Port contract

Python under `python-gold/` is the spec. TypeScript under `templates/` is the product. A change that "improves" Python is a bug.

## Done

`bun test ./.claude/skills/sssf/tools/parity/` is green. That includes live-Python oracle tests and `fake_pi` cases that diff gold vs TS.

## Maintainer checks

`bun run lint` and `bun run typecheck` live at the repo root. They are not stamped into host repos.

## Rules

- Name-for-name modules. Field names that hit sqlite, JSON, prompts, or payloads stay snake_case.
- TypeScript identifiers are camelCase: `loadConfig`, `commitAll`, `artifactsExist`, `runTests`, `asEnvelope`, `run.adwId`. Gate **runtime** names stay snake_case (`artifactsExist.name === "artifacts_exist"`) because they land in sqlite. CLI dests stay argparse-shaped (`args.adw_id` from `--adw-id`).
- Zero npm dependencies in stamped ADWs. Bun APIs only. No stamped `package.json` or `tsconfig.json`.
- `compat/` owns every Python-runtime observable. No file outside `compat/` may call `JSON.stringify` for trace, envelope, or agent_map bytes. Use `pyJson` for `json.dumps` and `serdeJson` for `model_dump_json`.
- Known bugs stay bugs. See `design/PARITY.md` section 4. Negative tests must fail if a bug is "fixed".
- `protected_files` glob `adws/adw_*.py` becomes `adws/adw_*.ts` because the scripts are `.ts`. That is the only intentional glob change.
- `make_adw` emits `return run.finish()` because `run.succeeded` is a compile error.
- Do not add comments that narrate what the Python already stated. A comment stays only for a non-obvious why.

## Layout

Write into `.claude/skills/sssf/templates/adws/`. Do not edit `python-gold/`.
