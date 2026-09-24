import { describe, expect, test } from "bun:test";
import { shlexJoin } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/shell.ts";
import { GenericOutput } from "../../.claude/skills/sssf/templates/adws/adw_modules/dataTypes.ts";

describe("compat vs live Python", () => {
  test("serdeJson indent=2 matches pydantic modelDumpJson", () => {
    const payload = { status: "success", summary: "hi — there" };
    expect(GenericOutput.dumpJson(GenericOutput.parse(payload), 2)).toBe(
      '{\n  "status": "success",\n  "summary": "hi — there",\n  "artifacts": [],\n  "notes_for_next_agent": ""\n}',
    );
  });

  test("yaml empty doc is null", () => {
    expect(JSON.stringify(Bun.YAML.parse(""))).toBe("null");
  });

  test("shlexJoin matches shlex.join", () => {
    const argv = ["echo", "hello world", "it's"];
    expect(shlexJoin(argv)).toBe(`echo 'hello world' 'it'"'"'s'`);
  });
});
