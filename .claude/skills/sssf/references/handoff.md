# Handoff Reference

The envelope schema, the two-channel output contract, and the session directory layout. Context transfers in code, not in conversation.

## Two output channels

An agent produces output in two ways and no others:

1. Reference files written into `context_handoff/` for the agents that follow.
2. One final valid-JSON response, the envelope.

Code parses the response against the output type the call declared, saves it as `envelope.json`, and injects it into the next agent's user prompt.

## Envelope schema

Every output type extends `EnvelopeBase`:

```ts
export interface EnvelopeBase {
  status: "success" | "fail";   // the only required field
  summary: string;              // one sentence on what happened
  artifacts: string[];          // paths written, usually inside context_handoff/
  notes_for_next_agent: string; // what the next agent must know
}
```

`status` is load-bearing. An envelope that parses but reports `fail` fails the phase; an agent declaring its own failure is not a successful phase.

The starter types in `adw_modules/dataTypes.ts`. Each is an interface plus a same-named schema constant built with `envelopeType(...)`, which is what `outputType:` takes.

```ts
GenericOutput                     // EnvelopeBase with no extra fields; the fallback contract

PlanOutput      { commit_message }                                   // subject for the plan file itself
BuildOutput     { changed_files, commit_message }                    // consumed by the commit phase
ScoutOutput     { findings: { file, note }[] }
ReviewOutput    { approved, findings: { requirement, met, evidence }[], blocking }
DocumentOutput  { document_path, documented_files, commit_message }
```

`commit_message` defaults to empty, so a commit phase always pairs it with a fallback. Each one describes its own agent's product: the spec, the code, the write-up. A chain that commits per step (`adw_simple_sdlc.ts`) uses all three and never reuses one agent's sentence for another's diff.

Two more types are adapters, code results shaped as envelopes so an agent receives a deterministic result through the same door: `VerifyOutput { passed, failures }` from `quality.asEnvelope`, and `ChangesOutput { base, changed_files, insertions, deletions, stat, diff_path }` from `changes.asEnvelope`. There is no test output type; running the suite is a code phase.

The envelope is a manifest of claims. Gates verify those claims after the fact: declared artifacts exist and are non-empty, declared changes appear in the diff, declared tests pass. See `cookbooks/update_modules.md`.

## The typed-output rule

Every `ph.call` passes a concrete output type and the agent's final JSON is parsed against exactly that type.

```ts
const plan = await ph.call({
  outputType: PlanOutput,
  prompt,
  gates: [gates.artifactsExist],
}) as PlanOutput;
```

The user prompt asks for the shape; the type enforces it. They travel as a pair, which is what lets one agent serve many calls. Output types live in code, never in `sssf.config.yaml`.

**Parse failure is not a restart.** A response that does not parse or validate is re-prompted in the same session with a correction naming the required fields, up to `JSON_FIX_ATTEMPTS` in `agents.ts` (2). Gate violations use the same mechanism, bounded by the phase's `retries`. Pi treats `--session-id` as create-or-continue, so running and continuing an agent are the same call. The harness tolerates a fenced `json` block or prose around the object before parsing, but the prompt still asks for bare JSON, and every failed attempt is stored as an invalid `envelopes` row.

## Rendering the user prompt

`prompts.ts` renders the agent's `user.md`, substituting:

| Placeholder | Value |
|---|---|
| `{{prompt}}` | the engineer's ask, or the ADW's per-call prompt |
| `{{previous_envelope}}` | the upstream envelope JSON from `ph.call({ previous })`, or `(none)` |
| `{{context_handoff_dir}}` | absolute path to this session's `context_handoff/` |

A `user.md` declares one h3 per input, then the task, then the output contract:

````markdown
# Scout Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Find what `prompt` asks about. Write findings into `context_handoff_dir`, then emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `ScoutOutput`, no prose before or after:

```json
{
  "status": "success",
  "summary": "<one sentence on what you found>",
  "findings": [{ "file": "src/server.ts", "note": "<why this file matters>" }],
  "artifacts": ["<context_handoff_dir>/scout_findings.md"]
}
```
````

The `## Report` section shows the exact JSON shape of the declared output type. It lives in `user.md` because the shape belongs to the use, not the identity. The matching `system.md` stays static: Purpose and Instructions only.

## Session directory layout

```
adws/adw_data/sessions/{adw_id}/
├── agent_map.json          agent name → coding-agent session_id + model
├── context_handoff/        the one place agents write files for the agents that follow
└── {agent}/
    ├── prompts/            the exact system.md and user.md sent, saved before execution
    ├── pi_sessions/        pi's own session state for this agent
    ├── claude_sessions/    claude_code session markers (`<uuid>.created`)
    ├── raw_output.jsonl    the full JSONL stream, appended live
    └── envelope.json       the final parsed response
```

`session.ensure(cfg, adwId)` mints or joins the id and creates these directories. One `context_handoff/` per session, shared by every agent.

## agent_map.json and resuming

```json
{
  "planner": { "session_id": "sssf-a1b2c3d4-planner-9f2e", "model": "google/gemini-3.6-flash", "coding_agent": "pi" },
  "builder": { "session_id": "sssf-a1b2c3d4-builder-71ac", "model": "google/gemini-3.6-flash", "coding_agent": "pi" }
}
```

This map lets a later ADW rejoin each agent's existing context window. `adw_build.ts --adw-id a1b2c3d4` after `adw_plan.ts` resumes the builder's own session rather than starting cold. The map records the model each session was created with; if the config now names a different model, that agent starts fresh and the map is updated. `agent_sessions` in `sssf.db` is the queryable mirror.

Two processes joined to the same `adw_id` at the same time overwrite each other's `agent_map.json`. This is inherited from the Python original and deliberately not fixed.

Files are the raw record; the db is the queryable mirror. Losing `sssf.db` loses nothing that `raw_output.jsonl`, `envelope.json`, and `agent_map.json` cannot rebuild.
