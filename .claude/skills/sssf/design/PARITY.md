# Zero drift, made structural

"No behaviour drift" is an invariant. Invariants that live in a review checklist rot,
so this one lives in three structures: a single-owner compat layer, a frozen list of
observable contracts, and a differential harness that runs both implementations.

## 1. Every Python-runtime behaviour has exactly one owner

The port's failure mode is not a wrong algorithm. It is a thousand small semantic
differences between two standard libraries, each individually invisible. So no file
outside `compat/` may spell one out. Concretely:

| Observable | Python | TypeScript trap | Owner |
|---|---|---|---|
| timestamps | `datetime.now(timezone.utc).isoformat(timespec="milliseconds")` → `...+00:00` | `toISOString()` → `...Z` | `utils.nowIso` |
| ids | `secrets.token_hex(n // 2)` → n hex chars | `randomUUID()` is the wrong shape | `utils.newId` |
| trace JSON | `json.dumps` — `", "`/`": "` separators, `ensure_ascii=True` so `—` becomes `\u2014` | `JSON.stringify` — no spaces, raw UTF-8 | `compat/json.pyJson` |
| envelope JSON | `model_dump_json(indent=2)` — serde: `": "`, 2-space, **UTF-8 preserved** | same call, different encoder from the line above | `compat/json.serdeJson` |
| truncation | `s[-2000:]`, `s[:500]`, `len(s)` count **code points** | `slice`/`length` count UTF-16 units | `compat/format.pySlice`, `pyLen` |
| console values | `f"{k}: {v}"` renders `True`, `False`, `None`, `1.0` | `${v}` renders `true`, `false`, `null`, `1` | `compat/format.pyStr` |
| numbers in the banner | `f"{n:,}"`, `f"{c:.4f}"`, `f"{s:.1f}"` | `toLocaleString` locale drift, `toFixed` rounds half-up not half-even | `compat/format.comma`, `.fixed` |
| terminal output | `rich` markup + `Panel`, ANSI only on a TTY, `soft_wrap=True` | nothing equivalent | `compat/markup` |
| validation | pydantic v2 lax, `extra=ignore`, declaration-ordered dump, its own error prose | zod's messages differ, and its messages reach `phases.error` | `compat/schema` |
| command strings | `shlex.join` POSIX quoting | naive `join(" ")` | `compat/shell.shlexJoin` |
| glob | hand-rolled `*` that stops at `/`, `**` that does not | `Bun.Glob` has different semantics | `permissions` (ported verbatim, not delegated) |
| argv | argparse usage line, `error:` text, exit 2 | any arg library invents its own | `compat/cli` |
| YAML | `yaml.safe_load`, `None` on an empty doc | `undefined` | `compat/yaml` |
| sorting | `sorted()` compares code points | `Array.sort()` compares UTF-16 units | `compat/format.pySorted` |

Two JSON encoders is not an accident and not a candidate for unification. `json.dumps`
writes the trace; pydantic's serializer writes what an agent *reads*. They disagree on
non-ASCII, and every phase description in this codebase contains an em dash.

This is also why nothing here canonicalizes the JSONL line shape and the sqlite row
shape into one serializer. They already differ (`events.jsonl` carries `ts` and the
whole record; `events` carries columns plus `payload_json`) and they keep differing.
Only the byte-level encoder is shared.

## 2. The frozen contract list

`.claude/skills/sssf/design/CONTRACTS.md` enumerates every observable the port must reproduce. Each line is
a test. A change to any line is a spec change requiring a human decision, not a
refactor.

## 3. The differential harness

`tools/parity/` — not stamped into host repos, part of the port's own repo.

```
tools/parity/
  runBoth.ts         # run the Python ADW and the TS ADW against one fixture repo
  normalize.ts       # blank the fields that are legitimately non-deterministic
  compare.ts         # diff stdout, exit code, sqlite dump, session tree, events.jsonl
  oracle.py          # live Python oracle for json, schema, markup, yaml, shlex
  PORT_CONTRACT.md
  cli.test.ts  claude.test.ts  compare.test.ts  compat.test.ts  copilot.test.ts
  e2e.test.ts  exec.test.ts  install.test.ts  markup.test.ts  oracle.test.ts
  permissions.test.ts  phase.test.ts  registry.test.ts  signal.test.ts
  fixtures/
    fake_pi/  fake_claude/  fake_copilot/  fake_exec/
    repo_clean/  repo_agent/  repo_claude/  repo_copilot/  repo_exec/
  python-gold/
    scripts/         # install.py, which stamps from templates/
    templates/       # the Python product the installer copies
    adws/            # byte-identical to templates/adws
    justfile  env.sample  sssf.config.yaml
```

`fake_pi` is the load-bearing piece. It is a script on `PI_PATH` that:

- answers `--list-models` with a fixed catalog,
- asserts its argv **exactly**, in order, and fails the case if it differs,
- replays a recorded JSONL stream chosen by `--session-id` + turn number,
- so parse-retry, gate-correction and permission-breach paths are all reproducible.

Non-deterministic fields normalized before comparison: `adw_id` (when not pinned), the
4-hex suffix of a pi session id, `event_id`, `envelope_id`, every timestamp, every
duration, and pids. Everything else — including key order inside `payload_json` and the
exact ANSI bytes — is compared verbatim.

Comparison surface per case:

1. stdout bytes (with `TERM`/TTY forced both ways: colored and plain).
2. stderr bytes and exit code.
3. `sqlite3 sssf.db .dump` after normalization, table by table.
4. `find adws/adw_data/sessions -type f` plus the bytes of every file in it.
5. `events.jsonl` line by line.
6. `git status --porcelain` of the fixture repo (permission rollback correctness).

## 4. Contracts that only a negative test proves

These are the ones a port silently "improves". Each gets a case that fails if it is
fixed:

- `permissions.enforce()` is **skipped** when parse retries exhaust or gates fail —
  the phase dies before the audit runs, so an agent that breached *and* wrote bad JSON
  is never reported as a breach. Case: bad JSON + a write outside `writes` → expect the
  parse error, no `permission_breach` event, and the unauthorized file **still on disk**.
- `tools: []` omits `--tools` entirely, so an "empty allowlist" agent gets every pi
  default. Case: argv assertion with `tools: []` → no `--tools` token.
- `quality.test()` reports `operation: "build"`. Case: `payload_json.operation == "build"`
  for the `test` block.
- The quality `tool_call` payload has no `ok` key, so the UI renders a failed quality
  block as fine. Case: key set equality on the payload.
- `parent_id` is always `""`; no row is ever written with `status = 'queued'`. Case:
  `SELECT COUNT(*) FROM events WHERE parent_id != ''` = 0 and
  `SELECT COUNT(*) FROM phases WHERE status='queued'` = 0.
- `observability.poll_ms` is parsed and never read. Case: setting it to 5000 changes
  nothing.
- `--adw-id` joins the session and continues `seq`, but does **not** hydrate `previous`
  from a prior `envelope.json`. Case: joined run's first agent call renders
  `previous_envelope` as the six characters `(none)`.
- `makeAdw` emits `run.succeeded`, which does not exist. Case: generated file matches
  the golden template byte-for-byte.
- The cwd split: `gitHelper` runs git in the **process cwd** while `permissions` runs
  it in **`repo_root`**, and `gates.tests_pass` shells out with no cwd at all. Case:
  run an ADW from a subdirectory of the repo and assert each subprocess's cwd.
- `session.ensure` writes the session row *before* the first phase, and
  `agents.validate` raises *before* `ensure`, so a bad config leaves **no** session row.
  Case: `SELECT COUNT(*) FROM sessions` unchanged after a validation failure.
- Three finalization doors, and only `finish()` prints a verdict banner with a exit
  code: a phase throw closes the session `fail` and re-raises (exit 1 + a stack trace);
  `SIGTERM` closes it `fail` and exits 143; `finish()` returns 0 or 1. A throw must not
  be routed through `finish()`. Case: one per door, asserting the events written.
