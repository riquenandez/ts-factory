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

export interface SchemaProblem {
  loc: string;
  problem: string;
}

export class ValidationError extends Error {
  constructor(readonly modelName: string, readonly errors: SchemaProblem[]) {
    super(formatErrors(modelName, errors));
    this.name = "ValidationError";
  }
}

function formatErrors(modelName: string, errors: SchemaProblem[]): string {
  const lines = [`${modelName} validation failed:`];
  for (const err of errors) lines.push(`- ${err.loc}: ${err.problem}`);
  return lines.join("\n");
}

function fail(loc: string, problem: string): never {
  throw { loc, problem };
}

function oneOf(literals: unknown[] | undefined): string {
  return `must be one of: ${(literals ?? []).map((v) => String(v)).join(", ")}`;
}

function isProblem(value: unknown): value is SchemaProblem {
  return value !== null && typeof value === "object" && "problem" in value && "loc" in value;
}

function coerce(field: FieldSpec, value: unknown): unknown {
  if (value === undefined) {
    if (field.defaultFactory) return field.defaultFactory();
    if ("default" in field) return field.default;
    if (field.optional) return null;
    fail(field.name, "required");
  }
  if (value === null && field.optional) return null;
  switch (field.kind) {
    case "str":
      if (typeof value === "string") return value;
      return fail(field.name, "expected string");
    case "int":
      if (typeof value === "number" && Number.isInteger(value)) return value;
      if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
      if (typeof value === "boolean") return value ? 1 : 0;
      return fail(field.name, "expected integer");
    case "float":
      if (typeof value === "number") return value;
      if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) return Number(value);
      return fail(field.name, "expected number");
    case "bool":
      if (typeof value === "boolean") return value;
      if (value === 1 || value === "true" || value === "True" || value === "1") return true;
      if (value === 0 || value === "false" || value === "False" || value === "0") return false;
      return fail(field.name, "expected boolean");
    case "literal":
      if (field.literals?.includes(value)) return value;
      return fail(field.name, oneOf(field.literals));
    case "list": {
      if (!Array.isArray(value)) fail(field.name, "expected list");
      return value.map((item, index) => {
        if (!field.inner) return item;
        try {
          return coerce(field.inner, item);
        } catch (caught) {
          if (caught instanceof ValidationError) {
            throw new ValidationError(
              caught.modelName,
              caught.errors.map((err) => ({ ...err, loc: `${index}.${err.loc}` })),
            );
          }
          if (isProblem(caught)) fail(`${field.name}.${index}`, caught.problem);
          throw caught;
        }
      });
    }
    case "model":
      if (!field.model) fail(field.name, "expected object");
      return modelValidate(field.model, value);
    case "dict":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail(field.name, "expected object");
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
    throw new ValidationError(schema.name, [{ loc: schema.name, problem: "expected object" }]);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: SchemaProblem[] = [];
  for (const field of schema.fields) {
    try {
      out[field.name] = coerce(field, src[field.name]);
    } catch (caught) {
      if (caught instanceof ValidationError) {
        for (const err of caught.errors) {
          errors.push({ ...err, loc: `${field.name}.${err.loc}` });
        }
      } else if (isProblem(caught)) {
        errors.push({ loc: caught.loc, problem: caught.problem });
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

export function fieldNames(schema: Schema): string[] {
  return schema.fields.map((f) => f.name);
}
