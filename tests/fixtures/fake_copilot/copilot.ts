#!/usr/bin/env bun
/**
 * fake_copilot — replay recorded JSONL and assert argv.
 *
 * Env:
 *   FAKE_COPILOT_JSONL     one transcript replayed to stdout
 *   FAKE_COPILOT_REPLAY    directory of {session_id}.{turn}.jsonl files
 *   FAKE_COPILOT_EXPECT    JSON array of expected argv tokens after the binary;
 *                          tokens "<uuid>" and "<any>" are wildcards
 *   FAKE_COPILOT_ARGV_LOG  append each print-mode argv as one JSON line
 *   FAKE_COPILOT_USAGE     path whose contents are written to --usage-output-file
 *   FAKE_COPILOT_AGENT_LOG append the selected custom agent's body first line
 *   FAKE_COPILOT_EXIT      exit code after replay (default 0)
 *   FAKE_SLEEP_SECONDS     sleep this many seconds after argv checks, before replay (default 0)
 *   COPILOT_HOME           agents dir is $COPILOT_HOME/agents/<name>.agent.md
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { argvMatches, fakeSleep, flag, nextTurn, pickReplay } from "../replay.ts";

const replayFile = process.env.FAKE_COPILOT_JSONL ?? "";
const replayDir = process.env.FAKE_COPILOT_REPLAY ?? "";
const expectRaw = process.env.FAKE_COPILOT_EXPECT;
const argvLog = process.env.FAKE_COPILOT_ARGV_LOG ?? "";
const usageSrc = process.env.FAKE_COPILOT_USAGE ?? "";
const agentLog = process.env.FAKE_COPILOT_AGENT_LOG ?? "";
const exitCode = Number(process.env.FAKE_COPILOT_EXIT ?? "0");
const home = process.env.COPILOT_HOME ?? join(homedir(), ".copilot");

const got = process.argv.slice(2);

if (got.includes("--version") || got.includes("-v")) {
  process.stdout.write("1.0.83\n");
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
      `fake_copilot argv mismatch\nexpected: ${JSON.stringify(expected)}\ngot:      ${JSON.stringify(got)}\n`,
    );
    process.exit(2);
  }
}

const agentName = flag("--agent");
if (agentName) {
  const agentPath = join(home, "agents", `${agentName}.agent.md`);
  if (!existsSync(agentPath)) {
    process.stderr.write(`fake_copilot: no such agent file ${agentPath}\n`);
    process.exit(3);
  }
  if (agentLog) {
    const body = agentBody(readFileSync(agentPath, "utf8"));
    const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
    mkdirSync(dirname(agentLog), { recursive: true });
    appendFileSync(agentLog, firstLine + "\n");
  }
}

await fakeSleep();

const sessionId = flag("--session-id") ?? "";
let bytes: Uint8Array | null = null;
if (replayFile) {
  bytes = await pickReplay({ file: replayFile });
} else if (replayDir) {
  const turn = nextTurn(replayDir, sessionId || "unknown");
  bytes = await pickReplay({ dir: replayDir, key: sessionId, turn });
  if (!bytes) {
    process.stderr.write(`fake_copilot: no replay for session ${sessionId} turn ${turn} in ${replayDir}\n`);
    process.exit(1);
  }
}

if (bytes) await Bun.write(Bun.stdout, bytes);

const usageOut = flag("--usage-output-file");
if (usageOut) {
  mkdirSync(dirname(usageOut), { recursive: true });
  if (usageSrc && existsSync(usageSrc)) {
    writeFileSync(usageOut, readFileSync(usageSrc));
  } else {
    writeFileSync(
      usageOut,
      JSON.stringify({
        totalPremiumRequestCost: 0,
        totalUserRequests: 1,
        totalNanoAiu: 0,
        totalApiDurationMs: 0,
        sessionStartTime: "2026-09-14T00:00:00.000Z",
        codeChanges: { linesAdded: 0, linesRemoved: 0, filesModifiedCount: 0, filesModified: [] },
        modelMetrics: {
          "gpt-5.4": {
            requests: { count: 1, cost: 0 },
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            },
            totalNanoAiu: 0,
          },
        },
        agentMetrics: {},
      }),
    );
  }
}

process.exit(Number.isFinite(exitCode) ? exitCode : 0);

function agentBody(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(text);
  return match ? match[1]! : text;
}
