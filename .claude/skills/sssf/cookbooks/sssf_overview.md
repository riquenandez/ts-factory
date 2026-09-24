# SSSF Overview

The system map. Read once at startup, then route every request through SKILL.md.

## What it is

Deterministic TypeScript scripts (ADWs) own sequencing, retries, and acceptance. Coding agents (pi in v1) work inside bounded phases. Typed JSON envelopes carry context between phases. Every event streams into SQLite. Agent proposes, code disposes.

You are the orchestrator: launch ADWs, observe them, report. You never do the work an ADW exists to do.

## Layout of a stamped repo

```
adws/
├── adw_sssf_config/sssf.config.yaml   the agent roster: one agent, one prompt, one purpose
├── adw_*.ts                           the workflows; each opens with a `Phases:` line
├── adw_modules/                       all low-level logic; ADW scripts stay thin
│   ├── dataTypes.ts                   PhaseParams, AgentCall, EnvelopeBase + one output type per agent call
│   ├── runner.ts                      run.phase(params, body) and ph.call({ outputType, ... })
│   ├── agents.ts                      loadConfig, validate, execute
│   ├── gates.ts  quality.ts  changes.ts  permissions.ts  gitHelper.ts
│   └── runtimes/                      pi.ts, claude.ts, copilot.ts, exec.ts — one interface each
└── adw_data/
    ├── prompt_engineering/<agent>/    system.md + user.md, tracked, edit them here
    ├── harness_engineering/           pi extensions, tracked
    ├── sessions/<adw_id>/             gitignored runtime: agent_map.json, context_handoff/, <agent>/
    └── sssf.db                        gitignored trace db
```

## The phase model

A run is a sequence of `await run.phase({ name, kind, owner, description }, async (ph) => { ... })`. Three kinds:

- `engineer`: the request record. Every ADW opens with one.
- `agent`: `ph.call({ outputType, prompt, previous, gates })`. Prompt in, typed envelope out, gates verified.
- `code`: a deterministic step such as a commit, a test run, or a diff capture. Never inside an agent phase.

Every phase defaults to `fail` and earns `success`. An agent phase also needs its envelope to parse and its gates to pass. Gate violations and malformed JSON re-prompt the same session with a correction, never a restart. `run.finish({ accepted })` ends every ADW and sets the exit code, session status, and banner together.

## Envelopes

An agent has two output channels: files written into `context_handoff/`, and one final JSON response parsed against the call's `outputType`. Code saves it as `envelope.json` and injects it into the next agent's `user.md` as `{{previous_envelope}}`. Spec: `references/handoff.md`.

## Running an ADW

```bash
bun adws/adw_plan.ts "add a /health endpoint"                    # prints the adw_id
bun adws/adw_build.ts requests/health.md --adw-id a1b2c3d4         # joins that session
```

The prompt is inline text or a file path. `--adw-id` joins an existing session so agents resume their context windows. `--config` selects a roster.

## Next

Routing and the hard rules live in SKILL.md. Specs: `references/config.md`, `references/handoff.md`, `references/observability.md`.
