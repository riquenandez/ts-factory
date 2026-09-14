export function run(..._args: unknown[]): never {
  throw new Error(
    "coding_agent 'claude_code' is not implemented in v1 — SSSF v1 runs the " +
      "Pi coding agent only. Set coding_agent: pi (or omit it) in sssf.config.yaml.",
  );
}
