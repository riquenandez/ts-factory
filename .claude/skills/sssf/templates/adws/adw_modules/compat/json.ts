/**
 * Two JSON encoders, because the Python uses two and they disagree on non-ASCII.
 *
 * pyJson    → json.dumps (ensure_ascii=True, separators (", ", ": ") )
 * serdeJson → pydantic modelDumpJson (UTF-8 preserved, ": " after keys)
 */

/** A JSON number that must serialize like a Python float (`0.0`, not `0`). */
export class PyFloat {
  constructor(readonly value: number) {}
}

function escapeAscii(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else if (cp >= 0x80) {
      if (cp > 0xffff) {
        const u = cp - 0x10000;
        const hi = 0xd800 + (u >> 10);
        const lo = 0xdc00 + (u & 0x3ff);
        out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
      } else {
        out += `\\u${cp.toString(16).padStart(4, "0")}`;
      }
    } else out += ch;
  }
  return out;
}

function escapeUtf8(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out;
}

function encode(
  value: unknown,
  indent: number | undefined,
  level: number,
  ascii: boolean,
  floatHint?: boolean,
): string {
  if (value instanceof PyFloat) return encode(value.value, indent, level, ascii, true);
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Out of range float values are not JSON compliant");
    }
    if (floatHint && Number.isInteger(value)) {
      return Object.is(value, -0) ? "-0.0" : `${value}.0`;
    }
    return String(value);
  }
  if (typeof value === "string") {
    return `"${ascii ? escapeAscii(value) : escapeUtf8(value)}"`;
  }
  const pad = indent === undefined ? "" : "\n" + " ".repeat(indent * (level + 1));
  const close = indent === undefined ? "" : "\n" + " ".repeat(indent * level);
  const colon = indent === undefined ? ": " : ": ";
  const comma = indent === undefined ? ", " : ",";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const parts = value.map((v) => encode(v, indent, level + 1, ascii));
    if (indent === undefined) return `[${parts.join(comma)}]`;
    return `[${pad}${parts.join(comma + pad)}${close}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const parts = entries.map(([k, v]) =>
      `"${ascii ? escapeAscii(k) : escapeUtf8(k)}"${colon}${encode(v, indent, level + 1, ascii)}`,
    );
    if (indent === undefined) return `{${parts.join(comma)}}`;
    return `{${pad}${parts.join(comma + pad)}${close}}`;
  }
  throw new TypeError(`Object of type ${typeof value} is not JSON serializable`);
}

/** json.dumps(value) / json.dumps(value, indent=n). */
export function pyJson(value: unknown, indent?: number): string {
  return encode(value, indent, 0, true);
}

/** pydantic modelDumpJson — UTF-8 preserved. */
export function serdeJson(value: unknown, indent?: number): string {
  return encode(value, indent, 0, false);
}

export function isDict(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * json.loads. Rejects NaN/Infinity (JSON.parse already does) and rethrows
 * with Python's "Expecting value: line 1 column 1 (char 0)" shape when empty.
 */
export function pyLoads(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new SyntaxError("Expecting value: line 1 column 1 (char 0)");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(message);
  }
}
