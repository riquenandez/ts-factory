#!/usr/bin/env bun
/**
 * fake_pi — replay recorded JSONL and assert argv.
 *
 * Env:
 *   FAKE_PI_CATALOG   path to --list-models stdout (default: fixtures/fake_pi/catalog.txt)
 *   FAKE_PI_REPLAY    directory of {session_id}.{turn}.jsonl files
 *   FAKE_PI_EXPECT    JSON array of expected argv tokens after the binary name
 *   FAKE_PI_MODELS    JSON written as models.json when PI_MODELS_PATH is unset
 */

export {};

const DEFAULT_CATALOG = `Provider  Model  Context
openrouter  google/gemini-3.6-flash  272K
openai  gpt-5.6-terra  1.0M
fireworks  accounts/fireworks/models/kimi-k3  128K
`;

const catalog_path = process.env.FAKE_PI_CATALOG ?? "";
const replay_file = process.env.FAKE_PI_JSONL ?? "";
const replay_dir = process.env.FAKE_PI_REPLAY ?? "";
const expect_raw = process.env.FAKE_PI_EXPECT;

if (process.argv.includes("--list-models")) {
  const text = catalog_path ? await Bun.file(catalog_path).text() : DEFAULT_CATALOG;
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  process.exit(0);
}

if (expect_raw) {
  const expected = JSON.parse(expect_raw) as string[];
  const got = process.argv.slice(2);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    process.stderr.write(
      `fake_pi argv mismatch\nexpected: ${JSON.stringify(expected)}\ngot:      ${JSON.stringify(got)}\n`,
    );
    process.exit(2);
  }
}

const session_id = flag("--session-id");
let bytes: Uint8Array | null = null;
if (replay_file) {
  bytes = await Bun.file(replay_file).bytes();
} else if (replay_dir && session_id) {
  const raw_turns = [...new Bun.Glob(`${session_id}.*.jsonl`).scanSync({ cwd: replay_dir })];
  raw_turns.sort();
  const fallback = [...new Bun.Glob("*.jsonl").scanSync({ cwd: replay_dir })];
  fallback.sort();
  const turn_file = raw_turns[0] ?? fallback[0];
  if (!turn_file) {
    process.stderr.write(`fake_pi: no replay for session ${session_id} in ${replay_dir}\n`);
    process.exit(1);
  }
  bytes = await Bun.file(`${replay_dir}/${turn_file}`).bytes();
}

if (bytes) await Bun.write(Bun.stdout, bytes);

process.exit(0);

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}
