import { describe, expect, test } from "bun:test";
import { joinSessionFiles } from "./runAdw.ts";

function files(envelope: string): Record<string, string> {
  return { "abcd1234/envelope.json": envelope };
}

describe("session file snapshot text", () => {
  test("identical file maps join to the same text", () => {
    const body = '{"ok": true}';
    expect(joinSessionFiles(files(body))).toBe(joinSessionFiles(files(body)));
  });

  test("a differing envelope.json changes the joined text and names that path", () => {
    const joined = joinSessionFiles(files('{"ok": false}'));
    expect(joined).not.toBe(joinSessionFiles(files('{"ok": true}')));
    expect(joined).toContain("=== abcd1234/envelope.json ===");
    expect(joined).toContain('{"ok": false}');
  });
});
