#!/usr/bin/env bun
/**
 * fake_claude — replay recorded stream-json and assert argv.
 *
 * Env:
 *   FAKE_CLAUDE_JSONL     one transcript replayed to stdout
 *   FAKE_CLAUDE_REPLAY    directory of {session_id}.{turn}.jsonl files
 *   FAKE_CLAUDE_EXPECT    JSON array of expected argv tokens after the binary;
 *                         tokens "<uuid>" and "<any>" are wildcards
 *   FAKE_CLAUDE_ARGV_LOG  append each print-mode argv as one JSON line
 */

export {};

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const replayFile = process.env.FAKE_CLAUDE_JSONL ?? "";
const replayDir = process.env.FAKE_CLAUDE_REPLAY ?? "";
const expectRaw = process.env.FAKE_CLAUDE_EXPECT;
const argvLog = process.env.FAKE_CLAUDE_ARGV_LOG ?? "";

const got = process.argv.slice(2);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (got.includes("--version") || got.includes("-v")) {
  process.stdout.write("2.1.270 (Claude Code)\n");
  process.exit(0);
}

if (argvLog) {
  mkdirSync(dirname(argvLog), { recursive: true });
  appendFileSync(argvLog, JSON.stringify(got) + "\n");
}

if (expectRaw) {
  const expected = JSON.parse(expectRaw) as string[];
  if (!argvMatches(expected, got)) {
    process.stderr.write(
      `fake_claude argv mismatch\nexpected: ${JSON.stringify(expected)}\ngot:      ${JSON.stringify(got)}\n`,
    );
    process.exit(2);
  }
}

const sessionId = flag("--session-id") ?? flag("--resume") ?? "";
let bytes: Uint8Array | null = null;
if (replayFile) {
  bytes = await Bun.file(replayFile).bytes();
} else if (replayDir) {
  const turn = nextTurn(replayDir, sessionId || "unknown");
  const specific = join(replayDir, `${sessionId}.${turn}.jsonl`);
  const numbered = join(replayDir, `${turn}.jsonl`);
  if (existsSync(specific)) {
    bytes = await Bun.file(specific).bytes();
  } else if (existsSync(numbered)) {
    bytes = await Bun.file(numbered).bytes();
  } else {
    const matches = [...new Bun.Glob(`*.${turn}.jsonl`).scanSync({ cwd: replayDir })].sort();
    const turnFile = matches[0];
    if (!turnFile) {
      process.stderr.write(`fake_claude: no replay for session ${sessionId} turn ${turn} in ${replayDir}\n`);
      process.exit(1);
    }
    bytes = await Bun.file(join(replayDir, turnFile)).bytes();
  }
}

if (bytes) await Bun.write(Bun.stdout, bytes);

process.exit(0);

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

function argvMatches(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i]!;
    const have = actual[i]!;
    if (want === "<any>") continue;
    if (want === "<uuid>") {
      if (!UUID_RE.test(have)) return false;
      continue;
    }
    if (want !== have) return false;
  }
  return true;
}

function nextTurn(dir: string, sessionId: string): number {
  const path = join(dir, ".turns.json");
  let map: Record<string, number> = {};
  try {
    map = JSON.parse(readFileSync(path, "utf8")) as Record<string, number>;
  } catch {
    /* first call */
  }
  const n = (map[sessionId] ?? 0) + 1;
  map[sessionId] = n;
  writeFileSync(path, JSON.stringify(map));
  return n;
}
