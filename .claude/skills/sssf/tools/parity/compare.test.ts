import { describe, expect, test } from "bun:test";
import { diffSides, type Side } from "./compare.ts";

function side(over: Partial<Side> = {}): Side {
  return {
    exit: 0,
    stdout: "",
    stderr: "",
    dump: "",
    jsonl: "",
    files: { "abcd1234/envelope.json": '{"ok": true}' },
    porcelain: "",
    ...over,
  };
}

describe("diffSides session files", () => {
  test("identical sides return no misses", () => {
    expect(diffSides(side(), side())).toEqual([]);
  });

  test("a differing envelope.json is one miss naming that path", () => {
    const gold = side();
    const port = side({ files: { "abcd1234/envelope.json": '{"ok": false}' } });
    const misses = diffSides(gold, port);
    expect(misses).toHaveLength(1);
    expect(misses[0]).toContain("session file abcd1234/envelope.json");
  });
});
