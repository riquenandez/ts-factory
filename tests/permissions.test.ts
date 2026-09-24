import { describe, expect, test } from "bun:test";
import { changedPaths } from "../.claude/skills/sssf/factory/adws/adw_modules/permissions.ts";

describe("permission snapshot maps", () => {
  test("treats __proto__ as a path key, not an object trap", () => {
    const before = new Map<string, string>();
    const after = new Map([["__proto__", "untracked"]]);
    expect(changedPaths(before, after)).toEqual(["__proto__"]);
  });

  test("keeps integer-like keys in Python sorted order", () => {
    const before = new Map([
      ["10", "1,0"],
      ["2", "1,0"],
    ]);
    const after = new Map([
      ["10", "2,0"],
      ["2", "2,0"],
    ]);
    expect(changedPaths(before, after)).toEqual(["10", "2"]);
  });
});
