# Run ADW

Launch a workflow, watch it, report. Read `how_to_prompt_for_the_eng.md` first; it produces the prompt and picks the chain. This cookbook starts once you have both.

## Posture

The ADW is the worker. You launch it, watch the trace, and tell the engineer what happened. Do not read the target files to "help", do not fix code an agent was supposed to fix, do not edit an envelope. A failed run is reported with its failing phase and violations; the fix is a config, prompt, or ADW change, then a re-run.

## Launch

```bash
bun adws/<chain>.ts "add a /health endpoint"
bun adws/<chain>.ts requests/health.md --adw-id a1b2c3d4
bun adws/<chain>.ts "<prompt>" --config adws/adw_sssf_config/<other>.config.yaml
```

Launch in the background so you can poll. The `adw_id` is printed on startup; capture it.

**Rosters.** `--config` selects one; the justfile reads `SSSF_CONFIG` instead. If the engineer names a roster, a config, or a model tier, resolve it to a file on disk (`ls adws/adw_sssf_config/`) and pass it. Never swap rosters on your own; a different roster is a different cost and result. A joined run whose roster now names a different model for an agent starts that agent fresh instead of resuming, so say so when it applies.

**Sessions.** `--adw-id` joins an existing session or pins a new one to that id: same `sessions/<adw_id>/`, same `context_handoff/`, and each agent resumes its context window through `agent_map.json`. Plan under one id, then build under the same id.

## Observe

`adws/adw_data/sssf.db` is WAL. Poll it as often as you like.

```bash
sqlite3 adws/adw_data/sssf.db "select seq, name, kind, owner, status, attempt from phases where adw_id='a1b2c3d4' order by seq;"
sqlite3 adws/adw_data/sssf.db "select rowid, type, name, started_at from events where adw_id='a1b2c3d4' and rowid > 0 order by rowid limit 50;"
sqlite3 adws/adw_data/sssf.db "select attempt, gate, passed, checks_json from gate_results where adw_id='a1b2c3d4';"
sqlite3 adws/adw_data/sssf.db "select adw_id, request, status, total_tokens from sessions order by started_at desc limit 5;"
```

Poll events on a cursor: keep the highest `rowid` seen and query `rowid > ?`. The stamped justfile wraps these as `just sessions`, `just phases <id>`, `just tail <id>`, `just procs <id>`; `just obs` opens the UI on the same db. Event fields: `references/observability.md`.

Every line the ADW prints is also a `log` event, so tailing the background process and reading the db tell the same story. Raw record if you need more: `adws/adw_data/sessions/<adw_id>/<agent>/raw_output.jsonl`, `envelope.json`, `prompts/`, and `context_handoff/`.

## When a run is stuck

A hung agent produces no events, so the trace goes quiet rather than red.

```bash
just phases <adw_id>     # which phase is still running
just procs <adw_id>      # live processes for it, with pids and commands
```

If a pi child is alive but the phase has no `tool_call` events and its `raw_output.jsonl` is empty, the agent never started properly. Check that the model resolves before waiting it out. To stop a run, confirm each pid still runs the recorded command (`ps -p <pid> -o command=`, pids recycle), then `kill` the children first and the ADW process last. A killed run marks itself `fail` and closes its process rows.

## Report

In order: the chain and roster launched (name the config when it is not the default), the phase running now or the one that failed, phase statuses in sequence, and for a failure the gate violations or error verbatim. A phase showing `fail` may simply never have completed. Never dress up a partial run as a success.
