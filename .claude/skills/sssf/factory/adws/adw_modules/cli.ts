import { parseArgs as nodeParseArgs } from "node:util";
import { loadConfig, type SSSFConfig } from "./agents.ts";
import { ExitError, resolvePrompt } from "./utils.ts";

export interface ArgOption {
  name: string;
  dest?: string;
  default?: string | null;
  help?: string;
  required?: boolean;
  action?: "store" | "store_true";
}

export interface ArgSpec {
  prog?: string;
  description: string;
  positional: Array<{ name: string; help: string }>;
  options: ArgOption[];
}

export type CliValue = string | boolean | null;

export type ParsedArgs = Record<string, CliValue> & {
  prompt?: string;
  agent?: string;
  config?: string | null;
  adw_id?: string | null;
  force?: boolean;
  name?: string;
  agents?: string;
  base?: string;
};

function destOf(opt: ArgOption): string {
  if (opt.dest) return opt.dest;
  return opt.name.replace(/^--/, "").replace(/-/g, "_");
}

function optionKey(opt: ArgOption): string {
  return opt.name.replace(/^--/, "");
}

function die(code: number, line: string): never {
  process.stderr.write(line.endsWith("\n") ? line : line + "\n");
  process.exit(code);
}

export function parseArgs(spec: ArgSpec, argv: string[] = process.argv.slice(2)): ParsedArgs {
  const options: Record<string, { type: "string" | "boolean"; default?: string | boolean; short?: string }> = {
    help: { type: "boolean", short: "h", default: false },
  };
  for (const opt of spec.options) {
    const key = optionKey(opt);
    if (opt.action === "store_true") {
      options[key] = { type: "boolean", default: false };
    } else if (typeof opt.default === "string") {
      options[key] = { type: "string", default: opt.default };
    } else {
      options[key] = { type: "string" };
    }
  }

  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = nodeParseArgs({ args: argv, options, strict: true, allowPositionals: true });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    die(2, `error: ${message}`);
  }

  if (values.help === true) {
    const text = spec.description.endsWith("\n") ? spec.description : `${spec.description}\n`;
    process.stdout.write(text);
    process.exit(0);
  }

  const out: Record<string, CliValue> = {};
  for (const opt of spec.options) {
    const key = optionKey(opt);
    const dest = destOf(opt);
    const value = values[key];
    if (opt.action === "store_true") {
      out[dest] = value === true;
      continue;
    }
    if (opt.required && value === undefined) die(2, `error: missing required argument: ${opt.name}`);
    out[dest] = value === undefined ? (opt.default ?? null) : (value as string);
  }
  if (positionals.length < spec.positional.length) {
    const missing = spec.positional.slice(positionals.length).map((p) => p.name);
    die(2, `error: missing required argument: ${missing.join(", ")}`);
  }
  if (positionals.length > spec.positional.length) {
    const extra = positionals.slice(spec.positional.length).join(" ");
    die(2, `error: unrecognized arguments: ${extra}`);
  }
  spec.positional.forEach((p, i) => {
    out[p.name] = positionals[i]!;
  });
  return out;
}

export interface AdwContext {
  cfg: SSSFConfig;
  prompt: string;
  adwId: string | null;
  args: ParsedArgs;
}

const CONFIG_DEFAULT = "adws/adw_sssf_config/sssf.config.yaml";

export async function adw(
  doc: string,
  main: (ctx: AdwContext) => Promise<number>,
  extraOptions: ArgOption[] = [],
): Promise<never> {
  return runMain(async () => {
    const args = parseArgs({
      description: doc,
      positional: [{ name: "prompt", help: "inline text or a path to a prompt file" }],
      options: [
        ...extraOptions,
        { name: "--config", default: CONFIG_DEFAULT },
        { name: "--adw-id", default: null, help: "join or pin an existing session" },
      ],
    });
    const prompt = resolvePrompt(args.prompt!);
    const cfg = loadConfig(args.config ?? CONFIG_DEFAULT);
    const adwId = args.adw_id ?? null;
    return main({ cfg, prompt, adwId, args });
  });
}

export async function runMain(fn: () => Promise<number> | number): Promise<never> {
  try {
    const code = await fn();
    process.exit(code);
  } catch (error) {
    if (error instanceof ExitError) {
      if (error.message) process.stderr.write(error.message + (error.message.endsWith("\n") ? "" : "\n"));
      process.exit(error.code);
    }
    throw error;
  }
}
