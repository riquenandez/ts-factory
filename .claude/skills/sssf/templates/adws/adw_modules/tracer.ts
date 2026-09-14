/**
 * Tracer: every event lands in JSONL and SQLite AS IT HAPPENS.
 * Port of tracer.py. Files are the event stream; sssf.db is the queryable mirror.
 */

import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { appendFileSync } from "node:fs";
import { pyJson } from "./compat/json.ts";
import { pyHead } from "./compat/format.ts";
import { ensureDir, newId, nowIso } from "./utils.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  adw_id        TEXT PRIMARY KEY,
  adw_name      TEXT,                -- ADW script(s) run, e.g. "adw_plan + adw_build_test"
  request       TEXT,
  status        TEXT,
  engineer      TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0   -- review triage, set by the UI; never by a run
);
CREATE TABLE IF NOT EXISTS phases (
  phase_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'fail',
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  parent_id     TEXT,
  type          TEXT,
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS envelopes (
  envelope_id   TEXT PRIMARY KEY,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  agent         TEXT,
  output_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  phase_id      TEXT REFERENCES phases,
  attempt       INTEGER,
  gate          TEXT,
  passed        INTEGER,
  violations_json TEXT,
  checks_json   TEXT,               -- [{item, ok, note}] — WHAT the gate verified
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  adw_id        TEXT REFERENCES sessions,
  kind          TEXT,                -- 'adw' (the workflow process) | 'agent' (a coding-agent child)
  name          TEXT,                -- '' for the adw, the agent name for a child
  pid           INTEGER,
  command       TEXT,                -- what the pid was, so a recycled pid is not killed by mistake
  started_at    TEXT, ended_at TEXT  -- ended_at NULL = believed alive
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  adw_id        TEXT REFERENCES sessions,
  agent         TEXT,
  coding_agent  TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER,           -- window occupancy after the agent's last turn
  context_window INTEGER,           -- the model's ceiling; 0/NULL = unknown
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (adw_id, agent)
);
`;

export const MIGRATIONS: Array<[string, string, string]> = [
  ["agent_sessions", "color", "TEXT"],
  ["gate_results", "checks_json", "TEXT"],
  ["sessions", "adw_name", "TEXT"],
  ["agent_sessions", "context_tokens", "INTEGER"],
  ["agent_sessions", "context_window", "INTEGER"],
  ["sessions", "archived", "INTEGER DEFAULT 0"],
];

export type ParseAttempt = number;
export type GateAttempt = number;

export interface EventRecord {
  adw_id: string;
  phase_id?: string;
  type: string;
  name?: string;
  payload?: Record<string, unknown>;
  parent_id?: string;
  tokens?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface PhaseRow {
  phase_id: string;
  adw_id: string;
  seq: number;
  params: {
    name: string;
    kind: string;
    owner: string;
    description: string;
    retries: number;
  };
  status: string;
  attempt: number;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface GateCheckDump {
  item: string;
  ok: boolean;
  note: string;
}

export interface GateReportLike {
  passed: boolean;
  violations: string[];
  checks: GateCheckDump[];
}

export interface AgentLabel {
  name: string;
  coding_agent: string;
  model: string;
  color: string;
}

export class Tracer {
  readonly dbPath: string;
  readonly eventsJsonl: string;
  readonly conn: Database;

  constructor(dbPath: string, eventsJsonl: string) {
    ensureDir(dirname(dbPath));
    ensureDir(dirname(eventsJsonl));
    this.dbPath = dbPath;
    this.eventsJsonl = eventsJsonl;
    this.conn = new Database(dbPath);
    this.conn.exec("PRAGMA journal_mode=WAL;");
    this.conn.exec("PRAGMA synchronous=NORMAL;");
    this.conn.exec("PRAGMA busy_timeout=5000;");
    this.conn.exec(SCHEMA);
    this._migrate();
  }

  private _migrate(): void {
    for (const [table, column, decl] of MIGRATIONS) {
      const columns = this.conn.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((c) => c.name === column)) {
        this.conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    }
  }

  event(record: EventRecord): string {
    const eventId = `evt_${newId(12)}`;
    const ts = nowIso();
    const dumped = {
      adw_id: record.adw_id,
      phase_id: record.phase_id ?? "",
      type: record.type,
      name: record.name ?? "",
      payload: record.payload ?? {},
      parent_id: record.parent_id ?? "",
      tokens: record.tokens ?? null,
      started_at: record.started_at ?? null,
      ended_at: record.ended_at ?? null,
    };
    const line = { event_id: eventId, ts, ...dumped };
    appendFileSync(this.eventsJsonl, pyJson(line) + "\n");
    this.conn.run(
      "INSERT INTO events (event_id, adw_id, phase_id, parent_id, type, name," +
        " payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        eventId,
        dumped.adw_id,
        dumped.phase_id,
        dumped.parent_id,
        dumped.type,
        dumped.name,
        pyJson(dumped.payload),
        dumped.tokens,
        dumped.started_at ?? ts,
        dumped.ended_at,
      ],
    );
    return eventId;
  }

  sessionStart(adwId: string, engineer: string, adwName: string | null = null): void {
    this.conn.run(
      "INSERT INTO sessions (adw_id, status, engineer, started_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(adw_id) DO UPDATE SET status='running'",
      [adwId, "running", engineer, nowIso()],
    );
    if (!adwName) return;
    const row = this.conn.query("SELECT adw_name FROM sessions WHERE adw_id=?").get(adwId) as
      | { adw_name: string | null }
      | null;
    const names = row?.adw_name ? row.adw_name.split(" + ") : [];
    if (!names.includes(adwName)) {
      names.push(adwName);
      this.conn.run("UPDATE sessions SET adw_name=? WHERE adw_id=?", [names.join(" + "), adwId]);
    }
  }

  sessionRequest(adwId: string, request: string): void {
    this.conn.run("UPDATE sessions SET request=? WHERE adw_id=?", [pyHead(request, 500), adwId]);
  }

  sessionFinish(adwId: string, ok: boolean): void {
    this.conn.run(
      "UPDATE sessions SET status=?, ended_at=? WHERE adw_id=?",
      [ok ? "success" : "fail", nowIso(), adwId],
    );
    this.processesEndAll(adwId);
  }

  sessionAddUsage(adwId: string, tokens: number, cost: number): void {
    this.conn.run(
      "UPDATE sessions SET total_tokens=total_tokens+?, total_cost=total_cost+? WHERE adw_id=?",
      [tokens, cost, adwId],
    );
  }

  processStart(adwId: string, kind: string, name: string, pid: number, command: string): void {
    this.conn.run(
      "INSERT INTO processes (adw_id, kind, name, pid, command, started_at) VALUES (?,?,?,?,?,?)",
      [adwId, kind, name, pid, pyHead(command, 500), nowIso()],
    );
  }

  processEnd(adwId: string, pid: number): void {
    this.conn.run(
      "UPDATE processes SET ended_at=? WHERE id = (" +
        "  SELECT id FROM processes WHERE adw_id=? AND pid=? AND ended_at IS NULL" +
        "  ORDER BY id DESC LIMIT 1)",
      [nowIso(), adwId, pid],
    );
  }

  processesEndAll(adwId: string): void {
    this.conn.run(
      "UPDATE processes SET ended_at=? WHERE adw_id=? AND ended_at IS NULL",
      [nowIso(), adwId],
    );
  }

  maxPhaseSeq(adwId: string): number {
    const row = this.conn.query("SELECT MAX(seq) AS m FROM phases WHERE adw_id = ?").get(adwId) as
      | { m: number | null }
      | null;
    return row?.m ?? 0;
  }

  phaseUpsert(phase: PhaseRow): void {
    const p = phase.params;
    this.conn.run(
      "INSERT INTO phases (phase_id, adw_id, seq, name, kind, owner, description," +
        " status, attempt, retries, error, started_at, ended_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)" +
        " ON CONFLICT(phase_id) DO UPDATE SET status=excluded.status," +
        " attempt=excluded.attempt, error=excluded.error, ended_at=excluded.ended_at",
      [
        phase.phase_id, phase.adw_id, phase.seq, p.name, p.kind, p.owner, p.description,
        phase.status, phase.attempt, p.retries, phase.error, phase.started_at, phase.ended_at,
      ],
    );
  }

  envelopeRow(
    phase: PhaseRow,
    agent: string,
    outputType: string,
    payloadJson: string,
    valid: boolean,
    attempt: ParseAttempt,
  ): void {
    this.conn.run(
      "INSERT INTO envelopes (envelope_id, adw_id, phase_id, agent, output_type," +
        " payload_json, valid, attempt, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        `env_${newId(12)}`, phase.adw_id, phase.phase_id, agent, outputType,
        payloadJson, valid ? 1 : 0, attempt, nowIso(),
      ],
    );
  }

  gateRow(phase: PhaseRow, gate: string, report: GateReportLike, attempt: GateAttempt): void {
    this.conn.run(
      "INSERT INTO gate_results (adw_id, phase_id, attempt, gate, passed," +
        " violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        phase.adw_id, phase.phase_id, attempt, gate, report.passed ? 1 : 0,
        pyJson(report.violations), pyJson(report.checks), nowIso(),
      ],
    );
  }

  agentSessionRow(
    adwId: string,
    agent: AgentLabel,
    sessionId: string,
    contextTokens = 0,
    contextWindow = 0,
  ): void {
    const ts = nowIso();
    this.conn.run(
      "INSERT INTO agent_sessions (adw_id, agent, coding_agent, model, color," +
        " session_id, context_tokens, context_window, created_at, last_used_at)" +
        " VALUES (?,?,?,?,?,?,?,?,?,?)" +
        " ON CONFLICT(adw_id, agent) DO UPDATE SET model=excluded.model," +
        " color=excluded.color, session_id=excluded.session_id," +
        " context_tokens=excluded.context_tokens," +
        " context_window=excluded.context_window," +
        " last_used_at=excluded.last_used_at",
      [
        adwId, agent.name, agent.coding_agent, agent.model, agent.color,
        sessionId, contextTokens, contextWindow, ts, ts,
      ],
    );
  }
}
