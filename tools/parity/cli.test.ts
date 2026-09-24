import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/cli.ts";

function captureExit(fn: () => void): { code: number; stderr: string; stdout: string } {
  let code = -1;
  let stderr = "";
  let stdout = "";
  const exit = process.exit;
  const errWrite = process.stderr.write;
  const outWrite = process.stdout.write;
  process.exit = ((c?: number) => {
    code = c ?? 0;
    throw new Error(`__exit__${code}`);
  }) as typeof process.exit;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("__exit__")) throw error;
  } finally {
    process.exit = exit;
    process.stderr.write = errWrite;
    process.stdout.write = outWrite;
  }
  return { code, stderr, stdout };
}

const SPEC = {
  prog: "adw_prompt.ts",
  description: "ADW Prompt — the smallest ADW: one agent, one prompt, traced end-to-end.",
  positional: [{ name: "prompt", help: "inline text or a path to a prompt file" }],
  options: [
    { name: "--agent", default: "builder", help: "agent name from the config" },
    { name: "--config", default: "adws/adw_sssf_config/sssf.config.yaml" },
    { name: "--adw-id", default: null, help: "join or pin an existing session" },
  ],
};

describe("cli argparse shape", () => {
  test("parses prompt and flags", () => {
    const args = parseArgs(SPEC, ["hello", "--agent", "scout", "--adw-id", "abcd1234"]);
    expect(args.prompt).toBe("hello");
    expect(args.agent).toBe("scout");
    expect(args.adw_id).toBe("abcd1234");
  });

  test("defaults match Python", () => {
    const args = parseArgs(SPEC, ["hello"]);
    expect(args.agent).toBe("builder");
    expect(args.config).toBe("adws/adw_sssf_config/sssf.config.yaml");
    expect(args.adw_id).toBeNull();
  });

  test("splits inline flags on the first equals only", () => {
    const args = parseArgs(SPEC, ["hello", "--config=foo=bar.yaml"]);
    expect(args.config).toBe("foo=bar.yaml");
  });

  test("bare -- ends option parsing", () => {
    expect(parseArgs(SPEC, ["--", "hello"]).prompt).toBe("hello");
    expect(parseArgs(SPEC, ["--", "--not-a-flag"]).prompt).toBe("--not-a-flag");
  });

  test("missing prompt is one stderr line and exit 2", () => {
    const got = captureExit(() => parseArgs(SPEC, []));
    expect(got.code).toBe(2);
    expect(got.stderr).toBe("error: missing required argument: prompt\n");
    expect(got.stdout).toBe("");
  });

  test("unknown flag uses the parser message and exit 2", () => {
    const got = captureExit(() => parseArgs(SPEC, ["hello", "--nope"]));
    expect(got.code).toBe(2);
    expect(got.stderr).toBe(
      "error: Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--nope\"\n",
    );
  });

  test("-h prints the description and exits 0", () => {
    const got = captureExit(() => parseArgs(SPEC, ["-h"]));
    expect(got.code).toBe(0);
    expect(got.stdout).toBe(`${SPEC.description}\n`);
    expect(got.stderr).toBe("");
  });

  test("store_true writes a boolean, not the string true", () => {
    const forceSpec = {
      prog: "install.ts",
      description: "stamp",
      positional: [],
      options: [{ name: "--force", dest: "force", action: "store_true" as const }],
    };
    expect(parseArgs(forceSpec, []).force).toBe(false);
    expect(parseArgs(forceSpec, ["--force"]).force).toBe(true);
  });
});
