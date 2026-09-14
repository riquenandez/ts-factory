import { basename } from "node:path";

export class SystemExit extends Error {
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.name = "SystemExit";
    this.code = code;
  }
}

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

function flagUsage(opt: ArgOption): string {
  if (opt.action === "store_true") return `[${opt.name}]`;
  return `[${opt.name} ${destOf(opt).toUpperCase()}]`;
}

function usageLine(spec: ArgSpec, prog: string): string {
  const bits = ["usage:", prog, "[-h]"];
  for (const opt of spec.options) bits.push(flagUsage(opt));
  for (const pos of spec.positional) bits.push(pos.name);
  const joined = bits.join(" ");
  if (joined.length <= 78) return joined;
  const head = ["usage:", prog, "[-h]", ...spec.options.map(flagUsage)].join(" ");
  const indent = " ".repeat(Math.min(prog.length + 7, 21));
  return `${head}\n${indent}${spec.positional.map((p) => p.name).join(" ")}`;
}

function printHelp(spec: ArgSpec, prog: string): never {
  const lines = [usageLine(spec, prog), "", spec.description.trim(), ""];
  lines.push("positional arguments:");
  for (const pos of spec.positional) {
    lines.push(`  ${pos.name.padEnd(24)}${pos.help}`);
  }
  lines.push("", "options:");
  lines.push(`  ${"-h, --help".padEnd(24)}show this help message and exit`);
  for (const opt of spec.options) {
    const label = opt.action === "store_true" ? opt.name : `${opt.name} ${destOf(opt).toUpperCase()}`;
    const help = opt.help ?? "";
    lines.push(`  ${label.padEnd(24)}${help}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

function splitFlag(tok: string): [name: string, inline: string | undefined] {
  const eq = tok.indexOf("=");
  if (eq === -1) return [tok, undefined];
  return [tok.slice(0, eq), tok.slice(eq + 1)];
}

export function parseArgs(spec: ArgSpec, argv: string[] = process.argv.slice(2)): ParsedArgs {
  const prog = spec.prog ?? basename(process.argv[1] ?? "adw");
  const out: Record<string, CliValue> = {};
  for (const opt of spec.options) {
    out[destOf(opt)] = opt.action === "store_true" ? false : (opt.default ?? null);
  }
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "-h" || tok === "--help") printHelp(spec, prog);
    if (tok.startsWith("--")) {
      const [raw, inline] = splitFlag(tok);
      const opt = spec.options.find((o) => o.name === raw);
      if (!opt) {
        process.stderr.write(`${usageLine(spec, prog)}\n${prog}: error: unrecognized arguments: ${tok}\n`);
        process.exit(2);
      }
      if (opt.action === "store_true") {
        out[destOf(opt)] = true;
        continue;
      }
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined) {
        process.stderr.write(`${usageLine(spec, prog)}\n${prog}: error: argument ${raw}: expected one argument\n`);
        process.exit(2);
      }
      out[destOf(opt)] = value;
      continue;
    }
    positionals.push(tok);
  }
  if (positionals.length < spec.positional.length) {
    const missing = spec.positional.slice(positionals.length).map((p) => p.name);
    process.stderr.write(
      `${usageLine(spec, prog)}\n${prog}: error: the following arguments are required: ${missing.join(", ")}\n`,
    );
    process.exit(2);
  }
  if (positionals.length > spec.positional.length) {
    const extra = positionals.slice(spec.positional.length).join(" ");
    process.stderr.write(`${usageLine(spec, prog)}\n${prog}: error: unrecognized arguments: ${extra}\n`);
    process.exit(2);
  }
  spec.positional.forEach((p, i) => {
    out[p.name] = positionals[i]!;
  });
  return out;
}

export async function runMain(fn: () => Promise<number> | number): Promise<never> {
  try {
    const code = await fn();
    process.exit(code);
  } catch (error) {
    if (error instanceof SystemExit) {
      if (error.message) process.stderr.write(error.message + (error.message.endsWith("\n") ? "" : "\n"));
      process.exit(error.code);
    }
    throw error;
  }
}
