import { existsSync, readFileSync, statSync } from "node:fs";
import { modelValidate, type Schema } from "./schema.ts";
import { INTERFACES, unknownRuntime } from "./runtimes/index.ts";
import { ExitError, isDict } from "./utils.ts";

export const DEFAULT_PROTECTED = ["adws/adw_modules/", "adws/adw_sssf_config/", "adws/adw_*.ts"];

export function defaultConfig(): SSSFConfig {
  return {
    defaults: {
      coding_agent: "pi",
      model: "google/gemini-3.6-flash",
      thinking: "medium",
      color: "",
      harness_engineering: [],
      tools: null,
      protected_files: [...DEFAULT_PROTECTED],
      data_dir: "adws/adw_data",
    },
    observability: { db: "adws/adw_data/sssf.db", poll_ms: 500 },
    agents: [],
  };
}

const BASE = defaultConfig();

const STR_LIST = { name: "item", kind: "str" as const };

export interface PromptEngineering {
  system: string;
  user: string;
}

const PROMPT_ENGINEERING: Schema = {
  name: "PromptEngineering",
  fields: [
    { name: "system", kind: "str" },
    { name: "user", kind: "str" },
  ],
};

export interface AgentConfig {
  name: string;
  coding_agent: string;
  model: string;
  thinking: string;
  color: string;
  purpose: string;
  prompt_engineering: PromptEngineering;
  harness_engineering: string[];
  tools: string[] | null;
  writes: string[] | null;
  command: string[];
}

const AGENT_CONFIG: Schema = {
  name: "AgentConfig",
  fields: [
    { name: "name", kind: "str" },
    { name: "coding_agent", kind: "str", default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "purpose", kind: "str", default: "" },
    { name: "prompt_engineering", kind: "model", model: PROMPT_ENGINEERING },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "writes", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "command", kind: "list", defaultFactory: () => [], inner: STR_LIST },
  ],
};

export interface ConfigDefaults {
  coding_agent: string;
  model: string;
  thinking: string;
  color: string;
  harness_engineering: string[];
  tools: string[] | null;
  protected_files: string[];
  data_dir: string;
}

const CONFIG_DEFAULTS: Schema = {
  name: "ConfigDefaults",
  fields: [
    { name: "coding_agent", kind: "str", default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "protected_files", kind: "list", defaultFactory: () => [...DEFAULT_PROTECTED], inner: STR_LIST },
    { name: "data_dir", kind: "str", default: BASE.defaults.data_dir },
  ],
};

export interface ObservabilityConfig {
  db: string;
  poll_ms: number;
}

const OBSERVABILITY_CONFIG: Schema = {
  name: "ObservabilityConfig",
  fields: [
    { name: "db", kind: "str", default: BASE.observability.db },
    { name: "poll_ms", kind: "int", default: BASE.observability.poll_ms },
  ],
};

export interface SSSFConfig {
  defaults: ConfigDefaults;
  observability: ObservabilityConfig;
  agents: AgentConfig[];
}

export const SSSF_CONFIG: Schema = {
  name: "SSSFConfig",
  fields: [
    {
      name: "defaults",
      kind: "model",
      model: CONFIG_DEFAULTS,
      defaultFactory: () => modelValidate(CONFIG_DEFAULTS, {}),
    },
    {
      name: "observability",
      kind: "model",
      model: OBSERVABILITY_CONFIG,
      defaultFactory: () => modelValidate(OBSERVABILITY_CONFIG, {}),
    },
    { name: "agents", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "model", model: AGENT_CONFIG } },
  ],
};

const INHERITED_KEYS = ["coding_agent", "model", "thinking", "color", "tools", "writes"];

export function loadConfig(path = "adws/adw_sssf_config/sssf.config.yaml"): SSSFConfig {
  const loaded = Bun.YAML.parse(readFileSync(path, "utf8"));
  const raw: Record<string, unknown> = isDict(loaded) ? loaded : {};
  const defaults = isDict(raw.defaults) ? raw.defaults : {};
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  for (const agent of agents) {
    if (!isDict(agent)) continue;
    for (const key of INHERITED_KEYS) {
      if (Object.hasOwn(defaults, key) && !Object.hasOwn(agent, key)) agent[key] = defaults[key];
    }
    if (!Object.hasOwn(agent, "harness_engineering")) {
      agent.harness_engineering = Object.hasOwn(defaults, "harness_engineering") ? defaults.harness_engineering : [];
    }
  }
  return modelValidate(SSSF_CONFIG, raw) as unknown as SSSFConfig;
}

export function resolve(cfg: SSSFConfig, name: string): AgentConfig {
  for (const agent of cfg.agents) {
    if (agent.name === name) return agent;
  }
  const available = cfg.agents.map((a) => a.name);
  throw new ExitError(
    `agent '${name}' is not defined in the config — ` +
      `available: ${available.length ? available.join(", ") : "(none)"}`,
  );
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function validate(cfg: SSSFConfig, required: string[]): void {
  const problems: string[] = [];
  for (const name of required) {
    let agent: AgentConfig;
    try {
      agent = resolve(cfg, name);
    } catch (error) {
      if (!(error instanceof ExitError)) throw error;
      problems.push(error.message);
      continue;
    }
    for (const [label, ref] of [["system", agent.prompt_engineering.system], ["user", agent.prompt_engineering.user]]) {
      if (!isFile(ref!)) problems.push(`agent '${name}': ${label} prompt not found: ${ref}`);
    }
    const iface = INTERFACES[agent.coding_agent];
    if (!iface) problems.push(unknownRuntime(agent));
    else problems.push(...iface.validate(agent));
  }
  if (problems.length) {
    throw new ExitError("config validation failed:\n- " + problems.join("\n- "));
  }
}
