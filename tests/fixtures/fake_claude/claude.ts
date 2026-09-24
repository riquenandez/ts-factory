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
 *   FAKE_SLEEP_SECONDS    sleep this many seconds after argv checks, before replay (default 0)
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { argvMatches, fakeSleep, flag, nextTurn, pickReplay } from "../replay.ts";

const replayFile = process.env.FAKE_CLAUDE_JSONL ?? "";
const replayDir = process.env.FAKE_CLAUDE_REPLAY ?? "";
const expectRaw = process.env.FAKE_CLAUDE_EXPECT;
const argvLog = process.env.FAKE_CLAUDE_ARGV_LOG ?? "";

const got = process.argv.slice(2);

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

await fakeSleep();

const sessionId = flag("--session-id") ?? flag("--resume") ?? "";
let bytes: Uint8Array | null = null;
if (replayFile) {
  bytes = await pickReplay({ file: replayFile });
} else if (replayDir) {
  const turn = nextTurn(replayDir, sessionId || "unknown");
  bytes = await pickReplay({ dir: replayDir, key: sessionId, turn });
  if (!bytes) {
    process.stderr.write(`fake_claude: no replay for session ${sessionId} turn ${turn} in ${replayDir}\n`);
    process.exit(1);
  }
}

if (bytes) await Bun.write(Bun.stdout, bytes);

process.exit(0);
