import { describe, expect, test } from "bun:test";
import { pyJson } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/json.ts";
import { comma, fixed, pyStr } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/format.ts";
import { shlexJoin } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/shell.ts";
import { pyYamlLoad } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/yaml.ts";
import { GenericOutput, ScoutOutput } from "../../.claude/skills/sssf/templates/adws/adw_modules/dataTypes.ts";

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected throw");
}

describe("compat vs live Python", () => {
  test("pyJson matches json.dumps including em dash escape", () => {
    const payload = { s: "a — b", n: 1 };
    expect(pyJson(payload)).toBe('{"s": "a \\u2014 b", "n": 1}');
  });

  test("pyJson indent=2 matches json.dumps indent=2", () => {
    const payload = { s: "a — b" };
    expect(pyJson(payload, 2)).toBe('{\n  "s": "a \\u2014 b"\n}');
  });

  test("serdeJson indent=2 matches pydantic modelDumpJson", () => {
    const payload = { status: "success", summary: "hi — there" };
    expect(GenericOutput.dumpJson(GenericOutput.parse(payload), 2)).toBe(
      '{\n  "status": "success",\n  "summary": "hi — there",\n  "artifacts": [],\n  "notes_for_next_agent": ""\n}',
    );
  });

  test("validate missing status matches pydantic error prefix", () => {
    expect(messageOf(() => GenericOutput.parse({ summary: "x" }))).toBe(
      "1 validation error for GenericOutput\nstatus\n  Field required [type=missing, input_value={'summary': 'x'}, input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/missing",
    );
  });

  test("validate int summary matches pydantic string_type", () => {
    expect(messageOf(() => GenericOutput.parse({ status: "success", summary: 3 }))).toBe(
      "1 validation error for GenericOutput\nsummary\n  Input should be a valid string [type=string_type, input_value=3, input_type=int]\n    For further information visit https://errors.pydantic.dev/2.12/v/string_type",
    );
  });

  test("validate nested ScoutOutput finding locates findings.0.file", () => {
    const payload = { status: "success", findings: [{ note: "x" }] };
    expect(messageOf(() => ScoutOutput.parse(payload))).toBe(
      "1 validation error for ScoutOutput\nfindings.0.file\n  Field required [type=missing, input_value={'note': 'x'}, input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/missing",
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
