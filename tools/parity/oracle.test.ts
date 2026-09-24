import { describe, expect, test } from "bun:test";
import { comma, fixed, pyStr } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/format.ts";
import { shlexJoin } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/shell.ts";
import { pyYamlLoad } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/yaml.ts";
import { GenericOutput } from "../../.claude/skills/sssf/templates/adws/adw_modules/dataTypes.ts";

describe("compat vs live Python", () => {
  test("serdeJson indent=2 matches pydantic modelDumpJson", () => {
    const payload = { status: "success", summary: "hi — there" };
    expect(GenericOutput.dumpJson(GenericOutput.parse(payload), 2)).toBe(
      '{\n  "status": "success",\n  "summary": "hi — there",\n  "artifacts": [],\n  "notes_for_next_agent": ""\n}',
    );
  });

  test("yaml empty doc is null", () => {
    expect(JSON.stringify(pyYamlLoad(""))).toBe("null");
  });

  test("shlexJoin matches shlex.join", () => {
    const argv = ["echo", "hello world", "it's"];
    expect(shlexJoin(argv)).toBe(`echo 'hello world' 'it'"'"'s'`);
  });

  test("comma grouping matches python {n:,}", () => {
    expect(comma(41233)).toBe("41,233");
  });

  test("fixed 4 matches python .4f", () => {
    expect(fixed(0.0181, 4)).toBe("0.0181");
  });

  test("fixed 1 matches python .1f including 12.36", () => {
    expect(fixed(12.36, 1)).toBe("12.4");
  });

  test("pyStr booleans", () => {
    expect(pyStr(true)).toBe("True");
    expect(pyStr(false)).toBe("False");
    expect(pyStr(null)).toBe("None");
  });
});
