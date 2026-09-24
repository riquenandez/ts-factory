import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

export function argvMatches(expected: string[], actual: string[]): boolean {
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

export function nextTurn(dir: string, sessionId: string): number {
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

export async function fakeSleep(): Promise<void> {
  const sleepSeconds = Number(process.env.FAKE_SLEEP_SECONDS ?? "0");
  if (Number.isFinite(sleepSeconds) && sleepSeconds > 0) await Bun.sleep(sleepSeconds * 1000);
}

/** Bytes for one replay, or null when nothing matches. `turn` selects
 * `<key>.<turn>.jsonl`, then `<turn>.jsonl`, then `*.<turn>.jsonl`.
 * Omitting `turn` selects `<key>.*.jsonl`, then `*.jsonl` (the pi fake). */
export async function pickReplay(opts: {
  file?: string;
  dir?: string;
  key?: string;
  turn?: number;
}): Promise<Uint8Array | null> {
  const { file, dir, key = "", turn } = opts;
  if (file) return await Bun.file(file).bytes();
  if (!dir) return null;
  if (turn != null) {
    const specific = join(dir, `${key}.${turn}.jsonl`);
    if (existsSync(specific)) return await Bun.file(specific).bytes();
    const numbered = join(dir, `${turn}.jsonl`);
    if (existsSync(numbered)) return await Bun.file(numbered).bytes();
    const matches = [...new Bun.Glob(`*.${turn}.jsonl`).scanSync({ cwd: dir })].sort();
    const name = matches[0];
    return name ? await Bun.file(join(dir, name)).bytes() : null;
  }
  if (!key) return null;
  const rawTurns = [...new Bun.Glob(`${key}.*.jsonl`).scanSync({ cwd: dir })].sort();
  const fallback = [...new Bun.Glob("*.jsonl").scanSync({ cwd: dir })].sort();
  const name = rawTurns[0] ?? fallback[0];
  return name ? await Bun.file(join(dir, name)).bytes() : null;
}
