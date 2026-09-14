/** yaml.safe_load: empty doc is null, then callers `|| {}`. */

export function pyYamlLoad(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = Bun.YAML.parse(text);
    return parsed === undefined ? null : parsed;
  } catch {
    throw new Error("yaml parse failed");
  }
}
