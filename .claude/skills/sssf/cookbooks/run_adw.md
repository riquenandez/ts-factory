# Run ADW

Run a workflow and report on it. **You run and observe. You never step into the process or do the work yourself.**

Read `how_to_prompt_for_the_eng.md` before you launch anything. The prompt you pass is read by every agent in the chain, so it gets written deliberately: same intent, sharper words, verified paths, and a stated "done means". That cookbook is the whole procedure; this one starts once you have the prompt.

## The orchestrator's posture

The ADW is the worker. Your job is to launch it, watch the trace, and tell the engineer what happened. Do not read the agent's target files and "help", do not fix the code an agent was supposed to fix, do not edit an envelope. If a run fails, report the failing phase and its violations. The fix is a config, prompt, or ADW change, made deliberately, and then a re-run.

## Launch

```bash
bun adws/<chain>.ts "add a /health endpoint"
bun adws/<chain>.ts requests/health.md --adw-id a1b2c3d4
bun adws/<chain>.ts "<prompt>" --config adws/adw_sssf_config/<other>.config.yaml
```

Launch in the background so you can poll. The `adw_id` is printed on startup; capture it.

**Rosters.** `--config` selects one; the justfile reads `SSSF_CONFIG` instead. If the engineer names a roster, a config, or a model tier, resolve it to a file on disk (`ls adws/adw_sssf_config/`) and pass it. 

Two things that bite:

- **Never swap rosters on your own.** A different roster is a different cost and a different result. If the default's model looks wrong for the work, say so and let the engineer choose.
- **Switching rosters mid-session breaks resumption.** `agent_map.json` records the model each session was created with, so a joined run (`--adw-id`) whose config now names a different model starts that agent fresh instead of resuming its context window. That is deliberate, but it means "plan on one roster, then build on another" costs the builder its accumulated context. Say so when you report it.

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
