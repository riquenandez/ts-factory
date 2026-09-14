import { serdeJson } from "./json.ts";
import { pyRepr } from "./format.ts";

export type FieldKind =
  | "str"
  | "int"
  | "float"
  | "bool"
  | "literal"
  | "list"
  | "model"
  | "dict"
  | "any"
  | "optional";

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  optional?: boolean;
  default?: unknown;
  defaultFactory?: () => unknown;
  literals?: unknown[];
  inner?: FieldSpec;
  model?: Schema;
}

export interface Schema {
  name: string;
  fields: FieldSpec[];
}

export class ValidationError extends Error {
  constructor(readonly modelName: string, readonly errors: Array<{ loc: string; msg: string; type: string; input: unknown }>) {
    super(formatPydantic(modelName, errors));
    this.name = "ValidationError";
  }
}

function typeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "dict";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  return typeof value;
}

function formatPydantic(modelName: string, errors: ValidationError["errors"]): string {
  const n = errors.length;
  const lines = [`${n} validation error${n === 1 ? "" : "s"} for ${modelName}`];
  for (const err of errors) {
    const shown = err.input === undefined ? {} : err.input;
    lines.push(err.loc);
    lines.push(`  ${err.msg} [type=${err.type}, input_value=${pyReprInput(shown)}, input_type=${typeName(shown)}]`);
    lines.push(`    For further information visit https://errors.pydantic.dev/2.12/v/${err.type}`);
  }
  return lines.join("\n");
}

function pyReprInput(value: unknown): string {
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (Array.isArray(value)) return `[${value.map(pyReprInput).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `'${k}': ${pyReprInput(v)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return String(value);
}

function coerce(field: FieldSpec, value: unknown): unknown {
  if (value === undefined) {
    if (field.defaultFactory) return field.defaultFactory();
    if ("default" in field) return field.default;
    if (field.optional) return null;
    throw { type: "missing", msg: "Field required", loc: field.name };
  }
  if (value === null && field.optional) return null;
  switch (field.kind) {
    case "str":
      if (typeof value === "string") return value;
      throw { type: "string_type", msg: "Input should be a valid string", loc: field.name };
    case "int":
      if (typeof value === "number" && Number.isInteger(value)) return value;
      if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
      if (typeof value === "boolean") return value ? 1 : 0;
      throw { type: "int_type", msg: "Input should be a valid integer", loc: field.name };
    case "float":
      if (typeof value === "number") return value;
      if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) return Number(value);
      throw { type: "float_type", msg: "Input should be a valid number", loc: field.name };
    case "bool":
      if (typeof value === "boolean") return value;
      if (value === 1 || value === "true" || value === "True" || value === "1") return true;
      if (value === 0 || value === "false" || value === "False" || value === "0") return false;
      throw { type: "bool_parsing", msg: "Input should be a valid boolean", loc: field.name };
    case "literal":
      if (field.literals?.includes(value)) return value;
      throw {
        type: "literal_error",
        msg: `Input should be ${field.literals?.map((v) => pyRepr(v)).join(" or ")}`,
        loc: field.name,
      };
    case "list": {
      if (!Array.isArray(value)) {
        throw { type: "list_type", msg: "Input should be a valid list", loc: field.name };
      }
      return value.map((item) => (field.inner ? coerce(field.inner, item) : item));
    }
    case "model":
      if (!field.model) throw { type: "model_type", msg: "Input should be a valid dictionary", loc: field.name };
      return modelValidate(field.model, value);
    case "dict":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw { type: "dict_type", msg: "Input should be a valid dictionary", loc: field.name };
      }
      return value;
    case "any":
      return value;
    case "optional":
      if (value === null) return null;
      return field.inner ? coerce(field.inner, value) : value;
  }
}

export function modelValidate(schema: Schema, raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(schema.name, [{
      loc: schema.name,
      msg: "Input should be a valid dictionary or instance",
      type: "model_type",
      input: raw,
    }]);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: ValidationError["errors"] = [];
  for (const field of schema.fields) {
    try {
      out[field.name] = coerce(field, src[field.name]);
    } catch (caught) {
      if (caught && typeof caught === "object" && "type" in caught) {
        const c = caught as { type: string; msg: string; loc: string };
        errors.push({ loc: c.loc, msg: c.msg, type: c.type, input: src[field.name] === undefined ? src : src[field.name] });
      } else {
        throw caught;
      }
    }
  }
  if (errors.length) throw new ValidationError(schema.name, errors);
  return out;
}

export function modelDump(schema: Schema, obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    let value = obj[field.name];
    if (value === undefined) {
      value = field.defaultFactory ? field.defaultFactory() : field.default ?? null;
    }
    if (field.kind === "model" && field.model && value && typeof value === "object") {
      out[field.name] = modelDump(field.model, value as Record<string, unknown>);
    } else if (field.kind === "list" && field.inner?.kind === "model" && field.inner.model && Array.isArray(value)) {
      out[field.name] = value.map((item) => modelDump(field.inner!.model!, item as Record<string, unknown>));
    } else {
      out[field.name] = value ?? null;
    }
  }
  return out;
}

export function modelDumpJson(schema: Schema, obj: Record<string, unknown>, indent?: number): string {
  return serdeJson(modelDump(schema, obj), indent);
}

export function fieldNames(schema: Schema): string[] {
  return schema.fields.map((f) => f.name);
}
