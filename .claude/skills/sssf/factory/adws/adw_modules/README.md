# adw_modules

The engine an ADW script calls. A script names agents, sequences phases, and returns `run.finish()`. This directory is everything else, and install stamps it into the host repo next to the scripts.

| File | Owns |
|---|---|
| `cli.ts` | `adw()`: parse args, resolve the prompt, load config, run, exit. `ExitError` |
| `agents.ts` | the roster: config types, schema, defaults, `loadConfig`, `resolve`, `validate` |
| `session.ts` | `ensure()`: pin or mint `adw_id`, open the trace, install signal doors |
| `runner.ts` | `Run`, `PhaseHandle`, `AgentPhaseHandle`, `phase()`, `request()`, `finish()`, phase records |
| `execute.ts` | one agent call: render the prompt, send, parse retries, gates, permissions, persist |
| `dataTypes.ts` | what an ADW author touches: `EnvelopeBase`, the output types, `PhaseParams`, `AgentCall`, `GateReport` |
| `schema.ts` | the declarative validator |
| `tracer.ts` | sqlite and `events.jsonl` |
| `console.ts` | the narrative, markup renderer included |
| `gates.ts` | claim verifiers |
| `quality.ts` | lint, typecheck, build, test blocks; `asEnvelope` |
| `permissions.ts` | repo fingerprint, rollback, `writes` and `protected_files` |
| `changes.ts` | git diff capture into `context_handoff/changes.diff`; `asEnvelope` |
| `gitHelper.ts` | low-level git |
| `shell.ts` | `spawnCaptured`, `spawnShell`, `spawnJsonl`, `shlexJoin`, `operatorEnv` |
| `utils.ts` | ids, time, `isDict`, `resolvePrompt`, engineer name, cleanup hooks |
| `runtimes/index.ts` | `INTERFACES`, `interfaceFor`, `unknownRuntime` |
| `runtimes/types.ts` | `AgentRequest`, `AgentResult`, `AgentInterface`, tool-call records |
| `runtimes/toolCalls.ts` | `labelFor`, `clip`, `textOf` |
| `runtimes/pi.ts` | the pi interface |
| `runtimes/claude.ts` | the claude_code interface |
| `runtimes/copilot.ts` | the copilot interface |
| `runtimes/exec.ts` | the exec interface |

## One agent call, top to bottom

1. `adw` parses the flags, resolves the prompt, loads the roster.
2. `session.ensure` pins or mints the session and returns a `Run`.
3. `run.phase` opens the phase and calls the body.
4. `AgentPhaseHandle.call` is the only door an agent phase has.
5. `execute` renders the prompt, sends, retries JSON, runs gates, enforces permissions, persists the envelope.
6. `runtimes/index.interfaceFor` picks the roster's coding agent.
7. `runtimes/<x>.run` builds that agent's argv and reads its stream.
8. `shell.spawnJsonl` is the one stdout tail.

`tracer` writes sqlite and `events.jsonl` on every step of that path.

## Import rules

- A runtime file (`pi.ts`, `claude.ts`, `copilot.ts`, `exec.ts`) imports only `./types.ts`, `./toolCalls.ts`, `../shell.ts`, `../utils.ts`, and Node or Bun builtins.
- `runtimes/index.ts` is the only engine file that imports a runtime.
- `utils.ts`, `shell.ts`, and `schema.ts` import nothing from the engine. Node and Bun builtins only.

## To add

- A runtime: one file in `runtimes/`, one line in `runtimes/index.ts`. Steps in `cookbooks/update_modules.md`.
- A gate: a function in `gates.ts`. Pin `.name` to snake_case; that string lands in sqlite.
- An output type: extend `EnvelopeBase` in `dataTypes.ts`. The type, the agent's `## Report` example, and every `outputType:` are one contract. Change any one, update all three.
