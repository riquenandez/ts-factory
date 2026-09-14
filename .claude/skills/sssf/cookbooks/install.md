# Install

`/sssf install` stamps the factory from the skill into the current repo.

## Run it

From the target repo root:

```bash
bun .claude/skills/sssf/scripts/install.ts
```

If the skill is in user scope, the path is `~/.claude/skills/sssf/scripts/install.ts`.

## What gets stamped

| Stamped | From | Tracked |
|---|---|---|
| `adws/adw_sssf_config/sssf.config.yaml` | `templates/sssf.config.yaml` | yes, the roster |
| `adws/adw_*.ts` | `templates/adws/` | yes, twelve starter ADWs |
| `adws/adw_modules/` | `templates/adws/adw_modules/` | yes |
| `adws/adw_data/prompt_engineering/<agent>/` | `templates/prompt_engineering/` | yes, the user-owned prompts |
| `adws/adw_data/harness_engineering/` | `templates/harness_engineering/` | yes, pi extensions (`subagents.ts`) |
| `.env.sample`, `justfile` | `templates/` | yes |
| `adws/adw_data/sessions/`, `adws/adw_data/sssf.db` | runtime | no, gitignored by the installer |

Prompts and extensions are the user's the moment they land. Edit them under `adws/adw_data/`, never inside the skill.

Re-running skips every existing file and reports what it skipped. `--force` overwrites all stamped files, config and prompts included, so commit first.

## After stamping

1. `cp .env.sample .env` and set the key for each provider the roster names. The starter roster names three; setting `defaults.model` and deleting per-agent `model:` lines reduces it to one.
2. `pi --version`, or set `PI_PATH` in `.env`.
3. Confirm `git status` shows `.env`, `adws/adw_data/sessions/`, and `adws/adw_data/sssf.db*` ignored.
4. ADWs that commit (`adw_plan_build`, `adw_plan_build_test`, `adw_simple_sdlc`) and `adw_document` (which diffs against `--base`, default `main`) need a git repo with one commit.
5. Smoke test: `just demo`, or `bun adws/adw_prompt.ts "say hello" --agent scout`. Green means config validated, session minted, pi ran, envelope parsed, trace written to `adws/adw_data/sssf.db`. Fix this before running anything larger.
