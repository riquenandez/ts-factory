/** Python string/number semantics for the places they are observable. */

export function pyLen(s: string): number {
  return [...s].length;
}

export function pySlice(s: string, start: number, end?: number): string {
  const chars = [...s];
  const len = chars.length;
  const from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
  let to = end === undefined ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
  if (to < from) to = from;
  return chars.slice(from, to).join("");
}

export function pyTail(s: string, n: number): string {
  return pySlice(s, -n);
}

export function pyHead(s: string, n: number): string {
  return pySlice(s, 0, n);
}

export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map((v) => pyRepr(v)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  }
  return String(value);
}

/** `str(1.0)` when we know the value came from a float field. */
export function pyFloatStr(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return Object.is(n, -0) ? "-0.0" : `${n}.0`;
  return String(n);
}

export function pyRepr(value: unknown): string {
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return pyStr(value);
}

export function comma(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [whole, frac] = Math.abs(n).toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? sign + grouped : `${sign}${grouped}.${frac}`;
}

export function fixed(x: number, digits: number): string {
  const factor = 10 ** digits;
  const scaled = x * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  const sign = x < 0 && rounded !== 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(digits, "0");
  return `${sign}${whole}.${frac}`;
}

export function pySorted(items: Iterable<string>): string[] {
  return [...items].sort((a, b) => {
    const aa = [...a];
    const bb = [...b];
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n; i++) {
      const d = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!;
      if (d !== 0) return d;
    }
    return aa.length - bb.length;
  });
}

export function removePrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export function collapseWhitespace(s: string): string {
  return s.trim().split(/\s+/).join(" ");
}
