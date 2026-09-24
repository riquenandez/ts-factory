import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shlexJoin } from "../.claude/skills/sssf/factory/adws/adw_modules/shell.ts";
import { GenericOutput } from "../.claude/skills/sssf/factory/adws/adw_modules/dataTypes.ts";
import { newId, nowIso } from "../.claude/skills/sssf/factory/adws/adw_modules/utils.ts";
import { Tracer } from "../.claude/skills/sssf/factory/adws/adw_modules/tracer.ts";

describe("ids and time", () => {
  test("nowIso uses +00:00 not Z", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
  });

  test("newId(8) is 8 hex chars", () => {
    expect(newId(8)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("json, yaml, and shell quoting", () => {
  test("dumpJson indent 2 keeps declaration order and an em dash", () => {
    const payload = { status: "success", summary: "hi — there" };
    expect(GenericOutput.dumpJson(GenericOutput.parse(payload), 2)).toBe(
      '{\n  "status": "success",\n  "summary": "hi — there",\n  "artifacts": [],\n  "notes_for_next_agent": ""\n}',
    );
  });

  test("an empty YAML document parses as null", () => {
    expect(JSON.stringify(Bun.YAML.parse(""))).toBe("null");
  });

  test("shlexJoin quotes a space and a single quote", () => {
    const argv = ["echo", "hello world", "it's"];
    expect(shlexJoin(argv)).toBe(`echo 'hello world' 'it'"'"'s'`);
  });
});

describe("tracer", () => {
  test("writes WAL sqlite and JSONL with payload_json not payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "sssf-"));
    const db = join(dir, "sssf.db");
    const jsonl = join(dir, "events.jsonl");
    const tracer = new Tracer(db, jsonl);
    tracer.sessionStart("abcd1234", "eng", "adw_plan");
    tracer.event({
      adw_id: "abcd1234",
      type: "log",
      name: "console",
      payload: { message: "hello — world", level: "info" },
    });
    const line = readFileSync(jsonl, "utf8").trim();
    expect(line).toContain('"event_id":"evt_');
    expect(line).toContain("—");
    expect(line).not.toContain("payload_json");
    const row = tracer.conn.query("SELECT payload_json FROM events").get() as { payload_json: string };
    expect(row.payload_json).toContain("—");
    const mode = tracer.conn.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode.toLowerCase()).toBe("wal");
    const session = tracer.conn.query("SELECT adw_name, status FROM sessions").get() as {
      adw_name: string;
      status: string;
    };
    expect(session.adw_name).toBe("adw_plan");
    expect(session.status).toBe("running");
    tracer.conn.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
