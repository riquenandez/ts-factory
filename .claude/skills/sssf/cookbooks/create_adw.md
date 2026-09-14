# Create ADW

Compose a new ADW: a thin TypeScript workflow over agents already in the roster. Design the chain, then generate or hand-write it.

## 1. Design the chain

**Which agents, in what order?** The five starters:

| Agent | Use when | Output type | Typical gates |
|---|---|---|---|
| `scout` | something must be found first; read-only | `ScoutOutput` | `artifactsExist` |
| `planner` | the work needs a plan before code changes | `PlanOutput` | `artifactsExist`, `filesNonEmpty` |
| `builder` | code must change | `BuildOutput` | `diffMatchesClaims` |
| `reviewer` | the change must be confirmed to be what was asked for | `ReviewOutput` | `artifactsExist`, `verdictConsistent` |
| `documenter` | finished work needs a write-up, from the diff | `DocumentOutput` | `artifactsExist`, `filesNonEmpty` |

Any agent with no sharper contract uses `GenericOutput`. A new kind of agent needs a config entry, a prompt pair, and an output type first: `update_config.md`.

There is no tester. Running the suite is a `kind: "code"` phase: `quality.runTests(run)`, then `quality.asEnvelope(result, "tests")` hands the result to the builder through the same door an agent's envelope would use. The suite answers "does it run"; only the reviewer answers "is this what was asked for".

**Where does code act?** Commits, migrations, test runs, and diff capture (`changes.capture(run, { base: "main", maxDiffLines: 2000, includeUntracked: true })` then `changes.asEnvelope(...)`) each get their own `kind: "code"` phase.

**Does anything loop?** Test-fix cycles are bounded fix loops (`update_adw.md`), not phase retries.

**What must each call prove?** Pick gates from `gates.ts`: `artifactsExist`, `filesNonEmpty`, `jsonParses`, `diffMatchesClaims`, `verdictConsistent`, `testsPass("cmd")`, or an inline one-off.

## 2. Ownership

- `kind: "agent"`: `owner` is an agent name from the roster. It selects the harness and the swim lane.
- `kind: "engineer"`: `owner: run.engineer`. Always the first phase.
- `kind: "code"`: `owner` is a short actor label (`"git"`, `"quality"`). All code phases share one lane.
- `name` is unique within the run; suffix in loops (`test_1`, `fix_1`).
- `description` is required and must say what the phase does and why, not restate the name. `validatePhaseParams` rejects blanks and restatements at construction (SKILL.md rule 7).
- `retries: N` on an agent phase buys N extra gate-correction rounds in the same session. Code phases do not retry.

## 3. Generate or write it

```bash
bun .claude/skills/sssf/scripts/makeAdw.ts --name review_docs --agents scout,builder
```

Writes `adws/adw_review_docs.ts` with one agent phase per name, chained by `previous:`. It creates no config entries or prompts. Then replace every generated phase description.

The canonical hand-written skeleton is `adws/adw_plan_build.ts`: engineer request, planner, builder, commit, `run.finish()`. Read it and copy its shape. Every ADW keeps the same arguments: a prompt (inline or a file path), `--config`, `--adw-id`.

## Non-negotiables

- Declare `REQUIRED_AGENTS` and call `agents.validate(cfg, REQUIRED_AGENTS)` before the first phase.
- Every `ph.call` declares a concrete `outputType` from `dataTypes.ts`.
- `previous:` carries the chain. Bulky context goes through `context_handoff/` files the envelope references.
- Commit in a code phase with a fallback message, as `adws/adw_plan_build.ts` does: the agent's `commit_message` if set, else `sssf(<adw_id>): <summary>`. Each of `PlanOutput`, `BuildOutput`, and `DocumentOutput` carries a `commit_message` for its own product; a chain that commits more than once uses each agent's own message. `gitHelper.commitAll` throws when there is no repo or nothing changed, which fails the phase.
- End with `return run.finish({ accepted, reason })` when the run has an acceptance criterion the phase statuses cannot express.
- Stay thin. Parsing, subprocesses, retry mechanics, and reusable predicates go in `adw_modules/` (`update_modules.md`).

## Before you ship it

1. `bun adws/adw_<name>.ts "a tiny real request"` and watch it go green.
2. `sqlite3 adws/adw_data/sssf.db "select seq,name,kind,owner,status from phases where adw_id='<id>' order by seq;"`
3. Read the final `envelope.json`. Is the output type earning its fields?
