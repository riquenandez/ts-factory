import { describe, expect, test } from "bun:test";
import { pyJson } from "../../templates/adws/adw_modules/compat/json.ts";
import { comma, fixed, pyStr } from "../../templates/adws/adw_modules/compat/format.ts";
import { shlexJoin } from "../../templates/adws/adw_modules/compat/shell.ts";
import { pyYamlLoad } from "../../templates/adws/adw_modules/compat/yaml.ts";
import { GenericOutput } from "../../templates/adws/adw_modules/dataTypes.ts";

const ORACLE = `${import.meta.dir}/oracle.py`;

async function oracle(args: string[]): Promise<string> {
  const proc = Bun.spawn(["uv", "run", ORACLE, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`oracle ${args[0]} exited ${code}: ${stderr}`);
  return stdout;
}

describe("compat vs live Python", () => {
  test("pyJson matches json.dumps including em dash escape", async () => {
    const payload = { s: "a — b", n: 1 };
    const gold = await oracle(["json", JSON.stringify(payload)]);
    expect(pyJson(payload)).toBe(gold);
  });

  test("pyJson indent=2 matches json.dumps indent=2", async () => {
    const payload = { s: "a — b" };
    const gold = await oracle(["json", JSON.stringify(payload), "2"]);
    expect(pyJson(payload, 2)).toBe(gold);
  });

  test("serdeJson indent=2 matches pydantic modelDumpJson", async () => {
    const payload = { status: "success", summary: "hi — there" };
    const gold = await oracle(["serde", JSON.stringify(payload)]);
    expect(GenericOutput.dumpJson(GenericOutput.parse(payload), 2)).toBe(gold);
  });

  test("validate missing status matches pydantic error prefix", async () => {
    const gold = JSON.parse(await oracle(["validate", JSON.stringify({ summary: "x" })])) as {
      ok: boolean;
      error: string;
    };
    expect(gold.ok).toBe(false);
    try {
      GenericOutput.parse({ summary: "x" });
      throw new Error("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const norm = (s: string) => s.replace(/errors\.pydantic\.dev\/\d+\.\d+\//g, "errors.pydantic.dev/<VER>/");
      expect(norm(message)).toBe(norm(gold.error));
    }
  });

  test("validate int summary matches pydantic string_type", async () => {
    const gold = JSON.parse(await oracle(["validate", JSON.stringify({ status: "success", summary: 3 })])) as {
      ok: boolean;
      error: string;
    };
    expect(gold.ok).toBe(false);
    try {
      GenericOutput.parse({ status: "success", summary: 3 });
      throw new Error("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const norm = (s: string) => s.replace(/errors\.pydantic\.dev\/\d+\.\d+\//g, "errors.pydantic.dev/<VER>/");
      expect(norm(message)).toBe(norm(gold.error));
    }
  });

  test("yaml empty doc is null", async () => {
    const gold = await oracle(["yaml", ""]);
    expect(JSON.stringify(pyYamlLoad(""))).toBe(gold.trimEnd());
  });

  test("shlexJoin matches shlex.join", async () => {
    const argv = ["echo", "hello world", "it's"];
    const gold = await oracle(["shlex", JSON.stringify(argv)]);
    expect(shlexJoin(argv)).toBe(gold);
  });

  test("comma grouping matches python {n:,}", async () => {
    const gold = await oracle(["format", "41233", "comma"]);
    expect(comma(41233)).toBe(gold);
  });

  test("fixed 4 matches python .4f", async () => {
    const gold = await oracle(["format", "0.0181", "cost"]);
    expect(fixed(0.0181, 4)).toBe(gold);
  });

  test("fixed 1 matches python .1f including 12.36", async () => {
    const gold = await oracle(["format", "12.36", "sec"]);
    expect(fixed(12.36, 1)).toBe(gold);
  });

  test("pyStr booleans", () => {
    expect(pyStr(true)).toBe("True");
    expect(pyStr(false)).toBe("False");
    expect(pyStr(null)).toBe("None");
  });
});
