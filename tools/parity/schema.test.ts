import { describe, expect, test } from "bun:test";
import { modelValidate, type Schema } from "../../.claude/skills/sssf/factory/adws/adw_modules/compat/schema.ts";
import { GenericOutput, ScoutOutput, SSSF_CONFIG } from "../../.claude/skills/sssf/factory/adws/adw_modules/dataTypes.ts";

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected throw");
}

describe("schema validation errors", () => {
  test("validate missing status matches pydantic error prefix", () => {
    expect(messageOf(() => GenericOutput.parse({ summary: "x" }))).toBe(
      "GenericOutput validation failed:\n- status: required",
    );
  });

  test("validate int summary matches pydantic string_type", () => {
    expect(messageOf(() => GenericOutput.parse({ status: "success", summary: 3 }))).toBe(
      "GenericOutput validation failed:\n- summary: expected string",
    );
  });

  test("validate nested ScoutOutput finding locates findings.0.file", () => {
    const payload = { status: "success", findings: [{ note: "x" }] };
    expect(messageOf(() => ScoutOutput.parse(payload))).toBe(
      "ScoutOutput validation failed:\n- findings.0.file: required",
    );
  });

  test("config agents.0.prompt_engineering.user", () => {
    const raw = { agents: [{ name: "scout", prompt_engineering: { system: "s.md" } }] };
    expect(messageOf(() => modelValidate(SSSF_CONFIG, raw))).toBe(
      "SSSFConfig validation failed:\n- agents.0.prompt_engineering.user: required",
    );
  });

  test("names every problem string", () => {
    const literal: Schema = {
      name: "Literal",
      fields: [{ name: "status", kind: "literal", literals: ["success", "fail"] }],
    };
    const integer: Schema = { name: "Integer", fields: [{ name: "n", kind: "int" }] };
    const list: Schema = { name: "List", fields: [{ name: "items", kind: "list", inner: { name: "item", kind: "str" } }] };
    const flag: Schema = { name: "Flag", fields: [{ name: "ok", kind: "bool" }] };
    const number: Schema = { name: "Number", fields: [{ name: "n", kind: "float" }] };
    expect(messageOf(() => modelValidate(literal, { status: "maybe" }))).toBe(
      "Literal validation failed:\n- status: must be one of: success, fail",
    );
    expect(messageOf(() => modelValidate(integer, { n: "no" }))).toBe(
      "Integer validation failed:\n- n: expected integer",
    );
    expect(messageOf(() => modelValidate(list, { items: "no" }))).toBe(
      "List validation failed:\n- items: expected list",
    );
    expect(messageOf(() => modelValidate(flag, { ok: "no" }))).toBe(
      "Flag validation failed:\n- ok: expected boolean",
    );
    expect(messageOf(() => modelValidate(number, { n: "no" }))).toBe(
      "Number validation failed:\n- n: expected number",
    );
    expect(messageOf(() => GenericOutput.parse([]))).toBe(
      "GenericOutput validation failed:\n- GenericOutput: expected object",
    );
  });
});
