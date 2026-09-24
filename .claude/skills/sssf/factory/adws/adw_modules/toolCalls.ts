import { isDict } from "./utils.ts";

export const RESULT_SNIPPET_CHARS = 20_000;
export const ARG_VALUE_CHARS = 20_000;
export const LABEL_CHARS = 80;

export const PRIMARY_ARGS = ["command", "path", "file_path", "pattern", "query", "url"];

export function textOf(container: Record<string, unknown>): string {
  const content = Array.isArray(container.content) ? container.content : [];
  let out = "";
  for (const part of content) {
    if (isDict(part) && part.type === "text") out += typeof part.text === "string" ? part.text : "";
  }
  return out;
}

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit).trimEnd() + "…";
}

export function labelFor(tool: string, args: Record<string, unknown>): string {
  let value = "";
  for (const key of PRIMARY_ARGS) {
    const candidate = args[key];
    if (typeof candidate === "string" && candidate.trim()) {
      value = candidate;
      break;
    }
  }
  if (!value) {
    value = (Object.values(args).find((v) => typeof v === "string" && v.trim()) as string | undefined) ?? "";
  }
  value = value.replace(/\s+/g, " ").trim();
  return value ? `${tool}: ${clip(value, LABEL_CHARS)}` : tool;
}
