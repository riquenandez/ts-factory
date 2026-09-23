import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/cli.ts";

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
