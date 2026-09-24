import { ExitError } from "../cli.ts";
import type { AgentConfig } from "../dataTypes.ts";
import type { AgentInterface } from "./types.ts";
import * as claude from "./claude.ts";
import * as copilot from "./copilot.ts";
import * as exec from "./exec.ts";
import * as pi from "./pi.ts";

export const INTERFACES: Record<string, AgentInterface> = {
  pi: pi.INTERFACE,
  claude_code: claude.INTERFACE,
  copilot: copilot.INTERFACE,
  exec: exec.INTERFACE,
};

export function unknownRuntime(agent: AgentConfig): string {
  return (
    `agent '${agent.name}': unknown coding_agent '${agent.coding_agent}'; ` +
    `known: ${Object.keys(INTERFACES).join(", ")}`
  );
}

export function interfaceFor(agent: AgentConfig): AgentInterface {
  const iface = INTERFACES[agent.coding_agent];
  if (!iface) throw new ExitError(unknownRuntime(agent));
  return iface;
}
