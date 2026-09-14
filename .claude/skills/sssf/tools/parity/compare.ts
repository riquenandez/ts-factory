import { normalizeText } from "./normalize.ts";

export interface Side {
  exit: number;
  stdout: string;
  stderr: string;
  dump: string;
  jsonl: string;
  files: Record<string, string>;
  porcelain: string;
}

export function diffSides(gold: Side, port: Side): string[] {
  const misses: string[] = [];
  if (gold.exit !== port.exit) misses.push(`exit ${gold.exit} vs ${port.exit}`);
  const gs = normalizeText(gold.stdout);
  const ps = normalizeText(port.stdout);
  if (gs !== ps) misses.push(`stdout\n--- gold ---\n${gs}\n--- port ---\n${ps}`);
  const ge = normalizeText(gold.stderr);
  const pe = normalizeText(port.stderr);
  if (ge !== pe) misses.push(`stderr\n--- gold ---\n${ge}\n--- port ---\n${pe}`);
  const gd = normalizeText(gold.dump);
  const pd = normalizeText(port.dump);
  if (gd !== pd) misses.push(`sqlite dump\n${firstDiff(gd, pd)}`);
  const gj = normalizeText(gold.jsonl);
  const pj = normalizeText(port.jsonl);
  if (gj !== pj) misses.push(`jsonl\n--- gold ---\n${gj}\n--- port ---\n${pj}`);
  const gk = Object.keys(gold.files).sort().join("\n");
  const pk = Object.keys(port.files).sort().join("\n");
  if (gk !== pk) misses.push(`session files\ngold:\n${gk}\nport:\n${pk}`);
  if (gold.porcelain !== port.porcelain) {
    misses.push(`git porcelain\ngold:\n${gold.porcelain}\nport:\n${port.porcelain}`);
  }
  return misses;
}

function firstDiff(a: string, b: string): string {
  const aa = a.split("\n");
  const bb = b.split("\n");
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (aa[i] !== bb[i]) {
      return `line ${i + 1}\n--- gold ---\n${aa[i] ?? "<missing>"}\n--- port ---\n${bb[i] ?? "<missing>"}`;
    }
  }
  return "texts equal after split (impossible)";
}
