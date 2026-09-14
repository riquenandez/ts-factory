import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function render(template_path: string, variables: Record<string, string>): string {
  let text = readFileSync(template_path, "utf8");
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll("{{" + key + "}}", value);
  }
  return text;
}

export function save(directory: string, name: string, content: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}
