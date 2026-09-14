# Module map

Two rings. The **factory** ring is a name-for-name port of `adw_modules/` — an engineer
who knows the Python knows where to look. The **compat** ring is new: it is where every
Python-runtime behaviour the observable contract depends on is reimplemented, once.

```
adws/
  adw_prompt.ts  adw_scout.ts  adw_plan.ts  adw_build.ts  adw_build_test.ts
    adw_build_review.ts  adw_plan_build.ts  adw_plan_build_test.ts
    adw_plan_build_test_quality.ts  adw_simple_sdlc.ts  adw_document.ts  adw_quality.ts
  adw_modules/
    index.ts        barrel: agents, changes, cli, gates, git_helper, permissions,
                    prompts, quality, session, utils  (NOT tracer/console)
    data_types.ts   envelope schemas + config schemas + plain engine records
    session.ts      ensure() — pin-or-create adw_id, build Run, install signal doors
    runner.ts       Run, PhaseHandle — the phase primitive and finish()
    agents.ts       loadConfig / validate / execute — parse retries, gates, permissions
    agent_pi.ts     pi argv, JSONL stream tail, ToolCallTracker, model resolution
    agent_cc.ts     stub: throws
    tracer.ts       SCHEMA + MIGRATIONS + every INSERT/UPDATE; JSONL append
    console.ts      the narrative — print AND trace, always together
    permissions.ts  git-fingerprint audit: snapshot / enforce / rollback
    gates.ts        claim verifiers
    quality.ts      deterministic lint/typecheck/build/test blocks
    changes.ts      git diff capture -> ChangeSet -> envelope
    git_helper.ts   low-level git
    prompts.ts      render {{placeholders}} + save the audit copy
    utils.ts        ids, timestamps, operator env, prompt resolution, engineer name
    compat/
      schema.ts     pydantic-shaped validation: ordered fields, defaults, extra=ignore,
                    pydantic-shaped error strings, model_dump / model_dump_json
      json.ts       TWO encoders: pyJson (stdlib json.dumps) and serdeJson (pydantic)
      format.ts     code-point slicing, Python str() of a value, :,d and :.4f
      markup.ts     the rich subset: markup -> (ansi, plain), escape(), Panel
      shell.ts      spawnSync/spawn wrappers, shlexJoin, operator env plumbing
      cli.ts        argparse-shaped parsing: usage line, error text, exit 2, SystemExit
      yaml.ts       yaml.safe_load equivalent (Bun.YAML.parse + empty-doc handling)
```

## Naming rule

**Field names are wire. Method names are code.**

Anything that reaches sqlite, JSONL, a prompt, or a `payload` keeps its Python
snake_case spelling: `adw_id`, `payload_json`, `notes_for_next_agent`, `changed_files`,
`output_type`, `phase_id`, `started_at`, `timeout_seconds`, `poll_ms`,
`protected_files`. Renaming any of them breaks the visualizer or a `## Report` example.

Functions and methods take TypeScript's idiom: `loadConfig`, `sessionFinish`,
`phaseUpsert`, `runQuality`, `asEnvelope`. `run.adwId` is a method-side property (never
serialized directly) — the tracer writes `adw_id` columns from it.

Two deliberate exceptions where the identifier *is* the contract the engineer reads:
`gates.artifactsExist` (exported camelCase; `.name` is pinned to `artifacts_exist` so `gate_results.gate` does not drift) and
`AgentCall.outputType` (hard rule 2 names the call-site key; the JSON field the agent emits is still the schema's snake_case `name:`).

## Public surface

An ADW script may only reach for these. Everything else is `@internal`.

| Call | From | Returns |
|---|---|---|
| `agents.loadConfig(path)` | `agents` | `SSSFConfig` |
| `agents.validate(cfg, required)` | `agents` | `void`, or throws `SystemExit` |
| `session.ensure(cfg, adwId?)` | `session` | `Run` (synchronous) |
| `run.phase(params, body)` | `runner` | `Promise<T>` — whatever `body` returned |
| `ph.log(payload)` | `runner` | `void` |
| `ph.call(agentCall)` | `runner` | `Promise<Envelope<F>>` |
| `run.finish({accepted?, reason?})` | `runner` | `number` — the exit code |
| `run.engineer` / `run.adwId` / `run.repoRoot` | `runner` | `string` |
| `gates.*`, `quality.*`, `changes.*`, `gitHelper.*`, `utils.resolvePrompt`, `cli.*` | leaf modules | domain values |

No sqlite row type, no `EventRecord`, no `PiResult`, no `PiRequest`, no `Tracer`, no
`Console` appears in any of those signatures. The engine's 7 tables, its two JSON
encoders, its ANSI renderer, its pi argv, its retry nesting and its permission audit
all sit behind `phase` / `call` / `finish`.

## Tracing a flow (≤3 files)

| Flow | Files |
|---|---|
| an agent phase, prompt to envelope | `adw_x.ts` → `runner.ts` → `agents.ts` |
| what pi was actually asked | `agents.ts` → `agent_pi.ts` |
| what reached the UI | `runner.ts`/`agents.ts` → `tracer.ts` |
| what reached the terminal | any caller → `console.ts` → `compat/markup.ts` |
| a permission breach | `agents.ts` → `permissions.ts` |
| a code phase's verdict | `adw_x.ts` → `quality.ts` |

`runner.ts` is the only file every flow passes through, and it is ~150 lines. Nothing
in the factory ring imports two hops down into `compat/` except through the one module
that owns that concern.

## Who writes what

| Writer | Writes | Conflict rule |
|---|---|---|
| ADW process `Tracer` | all 7 tables, `events.jsonl` | WAL + `busy_timeout=5000`; per-row upsert keyed on `phase_id` / `(adw_id, agent)`; `sessions.total_*` accumulates in SQL (`SET x = x + ?`), so two joined runs both land |
| ADW process `Run` | `sessions/{adw_id}/agent_map.json` | whole-file rewrite from in-memory state read at construction — **two processes on the same `adw_id` at the same time clobber each other.** Pre-existing in Python; deliberately not fixed |
| visualizer | `sessions.archived`, one column, own connection | human-triggered only |

The merge at the read boundary already exists and stays where it is: the visualizer's
`agentsFor()` unions finished `agent_sessions` rows with in-flight `agent_start` events,
letting the finished row win. Per-actor state is likewise already the shape — every
run owns `sessions/{adw_id}/`, every agent owns `sessions/{adw_id}/{agent}/`. The port
adds no lock, no queue, and no reconciliation pass, because adding one would change
what the UI sees.

## Runtime

Bun, for four reasons that are all contract, not taste:

1. `bun:sqlite` is **synchronous**, so the tracer writes inside a signal handler and
   inside a phase transition exactly where Python's `sqlite3` does.
2. `Bun.spawnSync` gives blocking git/quality/gate subprocesses, so `git_helper`,
   `permissions`, `changes`, `gates` and `quality` stay synchronous like their Python
   originals and async coloring is confined to `ph.call()`.
3. `Bun.spawn` streams pi's stdout while it works, which is the whole point of
   `agent_pi`.
4. The visualizer is already Bun, and `just obs` is unchanged.

`.env` is loaded by Bun at startup (replacing `python-dotenv`), which like
`load_dotenv()` does not override a real environment variable.
