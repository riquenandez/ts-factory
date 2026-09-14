# Observability Reference

The event schema, the seven SQLite tables, and the polling contract. One data path: agents write SQLite, readers poll SQLite.

## Two stores, one truth

Files are the raw record: `raw_output.jsonl`, `envelope.json`, `agent_map.json`. SQLite (`sssf.db`) is the queryable mirror the UI reads. `tracer.ts` writes both, and losing the db loses nothing the files cannot rebuild. The db path comes from `observability.db` in `sssf.config.yaml`, default `adws/adw_data/sssf.db`, gitignored in the target repo.

## Event types

`tracer.ts` emits these, every one logged against its `adw_id` and `phase_id`:

| Type | Emitted when |
|---|---|
| `phase_start` | a `run.phase(...)` block is entered |
| `agent_start` | a coding agent is spawned or resumed for `ph.call(...)` |
| `tool_call` | a tool returns. One event per real call, named as you would read it (`bash: ls -la src`), payload `{tool, tool_call_id, args, result_snippet, ok, duration_ms, agent}` |
| `handoff` | an envelope crosses from one agent to the next |
| `gate_pass` / `gate_fail` | a gate ran. Payload carries `attempt`, `checks` (the evidence), and `violations` |
| `log` | a `ph.log(...)` from the ADW, or a `run.console` line |
| `agent_end` | the agent's run completes, envelope parsed or not. Payload carries `cost`, `usage`, `context_tokens`, `context_window` |
| `phase_end` | the block exits, with the resolved status |
| `error` | a throw inside a phase block |

`parent_id` is reserved for span nesting and is always empty in v1.

**Spend is itemised per phase.** `agent_end.usage` carries tokens and dollars for `input`, `output`, `cache_read`, and `cache_write`, summed across every send the phase made, so a phase that retried shows what all its attempts cost. The four components sum to `total_tokens`; `reasoning_tokens` is the thinking share inside `output_tokens`, not a fifth component.

**Context is occupancy, not spend.** `events.tokens` and `sessions.total_tokens` bill every turn and only grow. `context_tokens` is how full the window was when the agent stopped, computed the way pi computes it for its own footer: the last valid assistant turn's `usage.totalTokens`, falling back to input plus output plus cache reads and writes. `context_window` is the model's ceiling from `~/.pi/agent/models.json`. Both are NULL on rows written before the columns existed.

**Gates record evidence.** A gate returns one `{item, ok, note}` check per thing it examined; `violations` are derived from the failed ones. Both land in `gate_results` and in the gate event payload, so a green gate can answer what it verified, not only that it passed.

**`tool_call` is the one event that spans time.** It fills both `started_at` and `ended_at`. Every other type is a point: `started_at` is when it was recorded and `ended_at` is NULL. Lay tool calls on a time axis from those columns, not from `payload_json`.

**Streaming is by construction.** `agentPi.ts` tails pi's JSONL stdout line by line and the tracer inserts each event while the agent is still working, so tool calls are visible mid-run.

## Tables

```sql
sessions (
  adw_id        TEXT PRIMARY KEY,
  request       TEXT,               -- the engineer's ask, first 500 chars
  status        TEXT,               -- running | success | fail
  engineer      TEXT,
  adw_name      TEXT,               -- every ADW that joined, " + " separated
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER, total_cost REAL,
  archived      INTEGER DEFAULT 0   -- review triage, set by the UI, never by a run
);

phases (
  phase_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail', -- success must be earned
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);

events (
  event_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  parent_id     TEXT,
  type          TEXT,                -- the types above
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);

envelopes (
  envelope_id   TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,                -- the dataTypes schema it parsed against
  payload_json  TEXT,
  valid         INTEGER,             -- 0 rows are the failed parse attempts
  attempt       INTEGER,
  created_at    TEXT
);

gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
  gate          TEXT,                -- the gate's runtime name, e.g. artifacts_exist
  passed        INTEGER,
  violations_json TEXT,              -- derived: the failed checks as "item: note"
  checks_json   TEXT,                -- [{item, ok, note}], everything the gate looked at
  created_at    TEXT
);

processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  kind          TEXT,                -- 'adw' (the workflow) | 'agent' (a coding-agent child)
  name          TEXT,                -- '' for the adw, the agent name for a child
  pid           INTEGER,
  command       TEXT,                -- what the pid was; verify before killing, pids recycle
  started_at    TEXT, ended_at TEXT  -- ended_at NULL = believed alive
);

agent_sessions (                     -- the queryable mirror of agent_map.json
  adw_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER, context_window INTEGER,
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (adw_id, agent)
);
```

**A hung agent emits nothing**, which is when you need its pid. `processes` answers "what is this run running": `just procs <adw_id>` lists rows with `ended_at IS NULL`. To stop a run, confirm each pid still runs the recorded `command`, then kill children before the parent. SIGTERM and SIGINT close the session as `fail` with its process rows ended and exit `128 + signal`, so a killed run never reads `running` forever.

**Phase status.** `running` on enter; `success` only on a clean exit, and for agent phases only with a parsed envelope and green gates; everything else is `fail`. The tracer never writes `queued`; the visualizer reserves that value for phases it knows about that have not started.

**Derived, never stored:** phase durations from `ended_at` minus `started_at`, session progress from `phases` by `adw_id`, lane layout from `kind` plus `owner`.

## WAL

Every connection, writer or reader, opens with:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

Readers never block writers. Concurrent writers are fine given one small transaction per event; two runs joined to the same `adw_id` both land because `sessions.total_*` accumulates in SQL. The visualizer reads on a read-only connection with one exception: archiving a session (`POST /api/sessions/:adw_id/archive`) sets `sessions.archived`, the reader's own state on the row.

## Polling contract

The UI never receives pushes. No ingest endpoint, no WebSocket, no backfill. Live view polls on a rowid cursor every `observability.poll_ms`:

```sql
SELECT ... FROM events WHERE adw_id = ? AND rowid > ? ORDER BY rowid LIMIT 500;
```

Keep the highest `rowid` returned as the next cursor. History is the same queries with filters, lazy-paged, so live and past runs share one mechanism and there is no separate replay path.
