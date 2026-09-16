import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runBoth } from "./runBoth.ts";

const FIXTURE = join(import.meta.dir, "fixtures/repo_clean");
const AGENT_FIXTURE = join(import.meta.dir, "fixtures/repo_agent");
const PI = join(import.meta.dir, "fixtures/fake_pi/pi.ts");
const MODELS = join(import.meta.dir, "fixtures/fake_pi/models.json");
const CATALOG = join(import.meta.dir, "fixtures/fake_pi/catalog.txt");
const JSONL = join(import.meta.dir, "fixtures/fake_pi/generic_ok.jsonl");

describe("gold vs port", () => {
  test("missing prompt is argparse exit 2", async () => {
    const misses = await runBoth(
      { name: "quality-missing-prompt", script: "adw_quality.ts", args: [] },
      FIXTURE,
    );
    expect(misses).toEqual([]);
  }, 60_000);

  test("placeholder quality blocks succeed with pinned adw-id", async () => {
    const misses = await runBoth(
      {
        name: "quality-placeholders",
        script: "adw_quality.ts",
        args: ["check", "--adw-id", "abcd1234"],
      },
      FIXTURE,
    );
    expect(misses).toEqual([]);
  }, 60_000);

  test("-- ends options so later flags become positionals", async () => {
    const misses = await runBoth(
      {
        name: "quality-end-of-options",
        script: "adw_quality.ts",
        args: ["--", "check", "--adw-id", "abcd1234"],
      },
      FIXTURE,
    );
    expect(misses).toEqual([]);
  }, 60_000);

  test("unknown agent fails validation with no session", async () => {
    const misses = await runBoth(
      {
        name: "prompt-unknown-agent",
        script: "adw_prompt.ts",
        args: ["hello", "--agent", "builder"],
      },
      FIXTURE,
    );
    expect(misses).toEqual([]);
  }, 60_000);

  test("adw_prompt scout via fake_pi produces matching traces", async () => {
    const misses = await runBoth(
      {
        name: "prompt-fake-pi",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: {
          PI_PATH: PI,
          PI_MODELS_PATH: MODELS,
          FAKE_PI_CATALOG: CATALOG,
          FAKE_PI_JSONL: JSONL,
        },
      },
      AGENT_FIXTURE,
    );
    expect(misses).toEqual([]);
  }, 60_000);
});
