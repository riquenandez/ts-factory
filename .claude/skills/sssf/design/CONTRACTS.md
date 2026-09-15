# Frozen observable contracts

The Python is the spec. Every line here is a test in `tools/parity/cases/`. A change to
any line is a spec change, not a refactor.

## CLI

- `bun adws/<script>.ts <prompt> [--config P] [--adw-id ID]`; plus `--agent` on
  `adw_prompt`, `--base` on `adw_document`. Defaults: `--config
  adws/adw_sssf_config/sssf.config.yaml`, `--adw-id` unset, `--agent builder`,
  `--base main`.
- Positional prompt is a file path if it resolves to a readable file, else inline text.
- Bad/missing args: argparse-shaped `usage: ...` + `<prog>: error: ...` on stderr,
  exit **2**.
- justfile recipe names and targets unchanged: `demo`, `prompt`, `scout`, `plan`,
  `plan-build`, `sdlc` → **`adw_plan_build_test`**, `simple-sdlc` →
  `adw_simple_sdlc`, `sessions`, `phases`, `tail`, `procs`, `obs`.
  `SSSF_CONFIG` still overrides the config for every recipe. `just obs` still passes
  `SSSF_DB` and boots on 4600/4601.

## Exit codes

| Path | Code |
|---|---|
| `finish()` with all phases green and `accepted` true | 0 |
| `finish()` otherwise | 1 |
| throw inside a phase (propagates) | 1, plus a stack trace on stderr |
| `SystemExit` (bad config, unknown agent) | 1, message on stderr, **no** stack |
| argparse failure | 2 |
| `SIGTERM` / `SIGINT` | 143 / 130 |

## Filesystem

```
adws/adw_data/
  sssf.db  sssf.db-wal  sssf.db-shm
  sessions/{adw_id}/
    events.jsonl
    agent_map.json                        # {agent: {session_id, model, coding_agent}}, indent 2
    context_handoff/
      changes.diff
      quality/{seq:02d}_{name}/command.log
      quality/{seq:02d}_build/bundle/
    {agent}/
      prompts/system.md  prompts/user.md  # the audit copy, written before the send
      pi_sessions/
      raw_output.jsonl                    # appended across every send in the run
      envelope.json                       # last valid envelope only
```

`prompts/system.md` and `prompts/user.md` are read by the visualizer's
`/api/sessions/:adw_id/agents/:agent/prompts` route. The path shape is API.

## SQLite

- Tables, in `SCHEMA` order: `sessions`, `phases`, `events`, `envelopes`,
  `gate_results`, `processes`, `agent_sessions`. No `runs` table.
- Column is `payload_json`, never `payload`.
- `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, autocommit.
- `MIGRATIONS` applied in order, additively, guarded by `PRAGMA table_info`:
  `agent_sessions.color`, `gate_results.checks_json`, `sessions.adw_name`,
  `agent_sessions.context_tokens`, `agent_sessions.context_window`,
  `sessions.archived INTEGER DEFAULT 0`.
- `sessions.adw_name` accumulates distinct script stems joined by `" + "`.
- `sessions.request` is the engineer phase's `input`, truncated to 500 code points.
- `phases` upsert on `phase_id` updates only `status, attempt, error, ended_at`.
- `processes.command` is truncated to 500; `process_end` closes the newest live row for
  that pid; `session_finish` closes all live rows for the run.
- `agent_sessions` upsert on `(adw_id, agent)`; written only **after** the envelope
  persists, so a running agent has no row (the UI fills the gap from `agent_start`).
- `events` are read by rowid cursor, so insertion order is the contract.

## Identifiers and timestamps

| Thing | Shape |
|---|---|
| `adw_id` | 8 lowercase hex |
| `phase_id` | `{adw_id}_{seq:02d}_{name}` |
| `event_id` | `evt_` + 12 hex |
| `envelope_id` | `env_` + 12 hex |
| pi session id | `sssf-{adw_id}-{agent}-{4 hex}`, reused when `agent_map` has the same model |
| timestamp | `2026-09-04T14:16:32.123+00:00` — millisecond precision, `+00:00`, never `Z` |

`seq` continues from `MAX(seq)` for the `adw_id`, so a joined run does not collide.

## Events

Ten types: `phase_start`, `phase_end`, `agent_start`, `agent_end`, `tool_call`,
`handoff`, `gate_pass`, `gate_fail`, `log`, `error`. Every console line is also a `log`
event carrying the **plain** (de-markup'd) text and a `level` of `info|warn|error`.

`events.jsonl` line: `{"event_id", "ts", "adw_id", "phase_id", "type", "name",
"payload", "parent_id", "tokens", "started_at", "ended_at"}` — the record's field order,
`ts` second. `started_at` defaults to the insert time in the **column**, and stays
`null` in the JSONL line when unset.

Per-phase ordering inside one agent call:

```
phase_start
log (console: phase header)
log (console: agent header)                # agent_start event precedes this log
agent_start
  … tool_call per completed pi tool call …
  [log per parse-retry console line, one invalid envelope row each]
  gate_pass|gate_fail per gate per attempt (+ a gate_results row each)
  [log per gate-retry console line]
  [error name=permission_breach]           # only on a breach
  [log name=paths_touched]                 # only when something was touched
handoff
agent_end                                  # tokens = phase total, not last send
log (console: agent footer)
phase_end
log (console: phase footer)
```

## Pi

argv, exactly, in order:

```
pi -p --mode json --provider <P> --model <M> --thinking <T>
   --session-id <S> --session-dir <ABS> --system-prompt <SYS>
   [--tools a,b,c]        # omitted entirely when tools is null OR empty
   [-e ext]…              # one pair per harness_engineering entry, in order
   <PROMPT>               # last positional
```

- `stdin` is `ignore`. `cwd` is `repo_root`. env is `operatorEnv()`.
- `--session-dir` and the raw output path are absolute.
- Model pattern resolution reads `pi --list-models` (once per process, memoized),
  skips the header line, needs ≥3 whitespace columns, and parses `272K`/`1.0M`.
  Exact `provider/id`, then unique exact-id, then unique substring; otherwise
  `not found` or `ambiguous` — both surfaced by `validate()`.
- `context_window` reads `~/.pi/agent/models.json` (`PI_MODELS_PATH`) **and throws if
  the file is absent**, before the spawn. Preserved.
- Every raw stdout byte is appended to `{agent}/raw_output.jsonl` as it arrives.
- `result.text` = the text blocks of the **last** assistant `message_end`.
- `context_tokens` = the last assistant turn whose `stopReason` is not `aborted`/`error`
  and whose count is nonzero. `tokens` = the sum over turns.
- Nonzero exit **and** empty text → throw `pi exited N: <last 800 chars of stderr>`.

## Retries

- 3 parse attempts per send (`JSON_FIX_ATTEMPTS = 2`); attempts 1 and 2 send a
  correction naming the output type's fields **in declaration order**; attempt 3's
  failure throws `<owner> never produced valid <Type> JSON: <pydantic error>`.
- Each failed parse writes an `envelopes` row with `valid=0` and
  `payload_json = {"raw": <last 2000 code points of the response>}`.
- Gate rounds: `for attempt in 1..max(1, retries+1)+1`, break when clean, and throw
  `GateFailure` once `attempt > retries`. `retries = 0` therefore allows exactly one
  evaluation and reports "after 1 attempt(s)".
- The parse budget **resets** on every gate correction.
- Every send reuses the same `--session-id`.
- `phase.attempt` is set to the gate attempt but only reaches the row at phase end.

## JSON extraction

Fenced blocks first: split on ` ``` `, take odd indices, `removePrefix("json")`
(case-sensitive), `trim()`, take the first that starts with `{`. Then first `{` to last
`}` of the chosen candidate. Then parse, then validate with unknown keys ignored.

## Permissions

- `snapshot()` before the first send: `git diff HEAD --numstat` fingerprints (last
  tab-field is the path, value `"adds,dels"`) plus `git ls-files --others
  --exclude-standard` as `"untracked"`. Run with `cwd = repo_root`; failures yield `""`.
- `enforce()` after the gate loop and **before** the envelope is accepted. Skipped
  entirely when parsing or gates threw.
- `permitted()` order: always-writable `data_dir/` → the agent's own `writes` →
  `protected_files` (deny) → `writes === null` means unrestricted, `[]` means none.
- Pattern semantics: trailing `/` is a prefix; `*` does not cross `/`; `**` does; `?`
  is one non-`/`; anything else is an exact match.
- A breach rolls back only what the agent *introduced*: untracked → unlink, tracked →
  `git checkout -- <path>`, already-dirty → left alone and reported as
  `REVERTED-BY-AGENT (uncommitted work lost, cannot restore)` or
  `left as-is (was already modified)`. Then it writes the `permission_breach` error
  event and throws. It is **not** a gate violation and never re-prompts.

## Console

Exact strings, ANSI when stdout is a TTY and plain when it is not:

```
adw_id: a1b2c3d4   engineer Enrique
▶ 03 build  agent · builder  Implement the plan exactly
  ▸ builder google/gemini-3.6-flash  session sssf-a1b2c3d4-builder-9f2c
  ⟳ builder retry 1/2 — same session · invalid BuildOutput JSON: …
  ✓ gate artifacts_exist 2 checked
    · specs/plan.md — exists, 2.1KB
  ✗ gate diff_matches_claims 1 of 3 failed
    ✗ src/x.ts — claimed changed file does not exist
  ✓ BuildOutput implemented the endpoint
    artifacts: specs/plan.md
  └ builder used 41,233 tokens · $0.0181
  · passed: True, checks: 1/1, artifacts: adws/adw_data/…/command.log
  ✓ build 12.4s
  ✗ test_1 0.3s  quality failed: …
```

plus the `ADW complete` panel, printed **once** per process, `expand=False`, rounded
box, border green on success and red on failure, rows `status / phases / tokens / cost
/ adw_id / db / next`. Dynamic text is clipped to 160 code points with `…`. `not
accepted: <reason>` prints as a `note` before the panel.

## Config

`yaml.safe_load` → for each agent, inherit `coding_agent, model, thinking, color,
tools, writes` from `defaults` **only when the key is present in `defaults`** (via
`setdefault`), then always `setdefault("harness_engineering", defaults.harness_engineering
or [])`. Unknown keys anywhere are ignored. `coding_agent` is a string, default `pi`.
`validate()` collects **all** problems and
raises one `SystemExit` listing them: unknown agent name, an unknown `coding_agent`,
plus whatever the named runtime's own `validate()` reports, a missing prompt file.

## Install

- Copies `templates/**` into cwd, preserving mode, skipping `__pycache__`, skipping any
  destination that exists unless `--force`.
- Appends missing `.gitignore` entries under a `# sssf runtime` heading.
- Prints `sssf installed into <cwd>`, the stamped count and list, the skipped count,
  then the four next steps and the raw fallback command.
- Idempotent: a second run stamps nothing and adds no `.gitignore` lines.

### The one deliberate divergence

`GITIGNORE_ENTRIES` drops `__pycache__/` and `*.pyc`. They exist because importing
`adw_modules` writes Python bytecode next to the source and `commit_all()` runs
`git add -A`. TypeScript emits no such artifact, and there is no analogue to substitute.
Everything else in the install output is unchanged except the three commands that name
the runtime (`uv run … .py` → `bun … .ts`).
