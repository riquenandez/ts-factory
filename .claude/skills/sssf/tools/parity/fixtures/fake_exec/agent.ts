#!/usr/bin/env bun
/**
 * fake_exec — a reference sssf-exec/1 adapter.
 *
 * Env:
 *   FAKE_EXEC_CHECK_EXIT  exit code for --check (default 0)
 *   FAKE_EXEC_JSONL       one transcript replayed to stdout
 *   FAKE_EXEC_REPLAY      directory of <n>.jsonl files, n = call number
 *   FAKE_EXEC_REQUEST_LOG append each stdin request as one JSON line
 *   FAKE_EXEC_EXIT        exit code after replay (default 0)
 *   FAKE_SLEEP_SECONDS    sleep this many seconds after argv checks, before replay (default 0)
 */

export {};

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.argv.includes("--check")) {
  process.stdout.write("ok\n");
  const checkExit = Number(process.env.FAKE_EXEC_CHECK_EXIT ?? "0");
  process.exit(Number.isFinite(checkExit) ? checkExit : 0);
}

if (process.env.SSSF_EXEC_PROTOCOL !== "sssf-exec/1") {
  process.stderr.write(
    `fake_exec: SSSF_EXEC_PROTOCOL must be sssf-exec/1 (got ${process.env.SSSF_EXEC_PROTOCOL ?? ""})\n`,
  );
  process.exit(4);
}

const raw = await Bun.stdin.text();
let request: Record<string, unknown>;
try {
  request = JSON.parse(raw) as Record<string, unknown>;
} catch (error) {
  process.stderr.write(`fake_exec: invalid request JSON: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const requestLog = process.env.FAKE_EXEC_REQUEST_LOG ?? "";
if (requestLog) {
  mkdirSync(dirname(requestLog), { recursive: true });
  appendFileSync(requestLog, JSON.stringify(request) + "\n");
}

const sessionId = typeof request.session_id === "string" && request.session_id ? request.session_id : "unknown";
const sessionDir = typeof request.session_dir === "string" ? request.session_dir : "";
mkdirSync(sessionDir, { recursive: true });
const callsPath = join(sessionDir, `${sessionId}.calls`);
const previous = existsSync(callsPath) ? Number(readFileSync(callsPath, "utf8").trim()) : 0;
const callNumber = (Number.isFinite(previous) ? previous : 0) + 1;
writeFileSync(callsPath, String(callNumber));

const sleepSeconds = Number(process.env.FAKE_SLEEP_SECONDS ?? "0");
if (Number.isFinite(sleepSeconds) && sleepSeconds > 0) {
  await Bun.sleep(sleepSeconds * 1000);
}

const replayFile = process.env.FAKE_EXEC_JSONL ?? "";
const replayDir = process.env.FAKE_EXEC_REPLAY ?? "";
let bytes: Uint8Array | null = null;
if (replayFile) {
  bytes = await Bun.file(replayFile).bytes();
} else if (replayDir) {
  const numbered = join(replayDir, `${callNumber}.jsonl`);
  if (!existsSync(numbered)) {
    process.stderr.write(`fake_exec: no replay for call ${callNumber} in ${replayDir}\n`);
    process.exit(1);
  }
  bytes = await Bun.file(numbered).bytes();
}
if (bytes) await Bun.write(Bun.stdout, bytes);

const exitCode = Number(process.env.FAKE_EXEC_EXIT ?? "0");
process.exit(Number.isFinite(exitCode) ? exitCode : 0);
