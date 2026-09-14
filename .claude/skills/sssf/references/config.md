# Config Reference

The full `sssf.config.yaml` spec: every field, how defaults merge, and how model, thinking, tools, extensions, and write permissions map onto the coding agent.

It lives at `adws/adw_sssf_config/sssf.config.yaml`, the default every `adw_*.ts` and the justfile resolve and where `install.ts` and `makeConfig.ts` stamp it. Pass `--config <path>` to any ADW, or set `SSSF_CONFIG` for the justfile, to run a different roster.

## Shape

```yaml
defaults:
  coding_agent: pi
  model: google/gemini-3.6-flash        # always provider/model-id
  thinking: medium
  harness_engineering: []
  tools: [read, bash, edit, write, grep, find, ls]
  protected_files: [adws/adw_modules/, adws/adw_sssf_config/, "adws/adw_*.ts"]
  data_dir: adws/adw_data

observability:
  db: adws/adw_data/sssf.db
  poll_ms: 500

agents:
  - name: planner
    model: fireworks/accounts/fireworks/models/kimi-k3
    thinking: high
    color: "#a78bfa"
    purpose: Turn a request into a plan the builder can implement without asking questions.
    prompt_engineering:
      system: adws/adw_data/prompt_engineering/planner/system.md
      user: adws/adw_data/prompt_engineering/planner/user.md
    harness_engineering:
      - adws/adw_data/harness_engineering/subagents.ts
    writes: [specs/]
    tools: [read, grep, find, ls, bash, write, subagent_create, subagent_continue, subagent_list, subagent_remove]
```

## Fields

### `defaults`

| Field | Type | Meaning |
|---|---|---|
| `coding_agent` | `pi` \| `claude_code` | Which interface runs the agent. Both are implemented in v1. `claude_code` runs `claude -p` headless and uses the machine's Claude Code login. |
| `model` | string | For `pi`: `provider/model-id`, resolved against pi's catalog. For `claude_code`: passed to `--model` as written (`opus`, `sonnet`, or a full id; no `provider/` prefix). Starter default `google/gemini-3.6-flash`. |
| `thinking` | enum | Reasoning effort, see below. Default `medium`. |
| `color` | hex string | Lane color for agents that do not set their own. Unset means the visualizer's palette. |
| `harness_engineering` | list of paths | Pi extension files, passed as `pi -e <path>`. Default none. |
| `tools` | list of names | Roster-wide allowlist inherited by agents that omit `tools`. Unset means all tools. |
| `protected_files` | list of patterns | Paths no agent may modify unless named in its own `writes`. Default: `adws/adw_modules/`, `adws/adw_sssf_config/`, `adws/adw_*.ts`. An agent must not be able to edit the machinery that grades it. |
| `data_dir` | path | Runtime home. Sessions land at `{data_dir}/sessions/{adw_id}/{agent}/`. Default `adws/adw_data`. |

### `observability`

| Field | Type | Meaning |
|---|---|---|
| `db` | path | The SQLite trace db `tracer.ts` writes and the visualizer polls. Default `adws/adw_data/sssf.db`. |
| `poll_ms` | int | Visualizer live-poll cadence. Default `500`. Parsed, not read by the ADW runtime. |

### `agents[]`

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The identifier ADW scripts use. ADWs name agents, never models. |
| `purpose` | yes | One sentence. Should match the system prompt's Purpose. |
| `prompt_engineering.system` | yes | Path to the system prompt: who the agent is and its one purpose. |
| `prompt_engineering.user` | yes | Path to the user prompt template with `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`, and a `## Report` section. |
| `coding_agent`, `model`, `thinking`, `color`, `harness_engineering`, `tools`, `writes` | no | Override the matching `defaults` key. |
| `writes` | no | What this agent may modify in the repo, enforced after every call. See below. |

Output types are deliberately absent. Config defines who an agent is; the ADW call site defines how it is used, so one agent serves many calls.

## Defaults merging and validation

`agents.ts` merges each entry over `defaults`, key by key. An entry states only what differs. `agents.validate(cfg, REQUIRED_AGENTS)` then confirms every name an ADW declares exists, that its model is written `provider/model-id`, and that both prompt files exist on disk. Any miss fails the run before an agent is spawned. It does not check that the provider is reachable or its key is set; a missing key fails when that agent runs.

## Thinking levels

```
off | minimal | low | medium | high | xhigh | max
```

Pi's reasoning-effort ladder. It applies only to models registered with `reasoning: true` in `~/.pi/agent/models.json`; on other models it is inert. `claude_code` maps it to `--effort`; `off` and `minimal` become `low`. Rough guidance: `high` or `xhigh` for planners and reviewers, `medium` for builders, `low` for mechanical read-and-report agents.

## Model resolution

Always write `provider/model-id`. The pi interface resolves the string against pi's merged catalog (`pi --list-models`). The leading segment is matched as the provider, so the rest may contain slashes (`fireworks/accounts/fireworks/models/kimi-k3`). A bare id that matches several providers is refused at validation with the candidates listed, and every agent inheriting that default is blocked until it is qualified. Registering a new provider that carries a model you already use can make a formerly valid bare id ambiguous without any config edit.

Credentials come from the environment, keyed by the provider pi maps the model to in `~/.pi/agent/models.json`. `.env.sample` lists the keys the starter roster needs.

The resolved model is recorded per session in `agent_map.json` and mirrored to `agent_sessions`. Changing an agent's model invalidates its session: a joined run starts that agent fresh instead of resuming a context window built by a different model. Thinking changes do not.

## Tools

`tools` maps to `pi --tools`. Pi's seven builtins:

| Tool | Purpose | Pi's own default |
|---|---|---|
| `read` | read file contents | on |
| `bash` | run a shell command | on |
| `edit` | find and replace | on |
| `write` | create or overwrite a file | on |
| `grep` | search file contents | off |
| `find` | find files by glob | off |
| `ls` | list a directory | off |

The starter roster sets `defaults.tools` to all seven and narrows per agent, because an agent without `grep`, `find`, and `ls` shells out through `bash` for the same work.

Resolution: the agent's own list wins; an agent that omits the key inherits `defaults.tools`; if neither is set, all tools are usable. An empty list is a tool-less agent, not "all tools".

**Extension tools must be named.** `--tools` filters built-in, extension, and custom tools alike. Once an agent has any `tools` list, its own or inherited, a tool registered by one of its `harness_engineering` extensions is dropped unless it appears by name. Nothing errors; the extension loads and its tool is never offered. Adding a tool-registering extension is therefore a two-part edit: the path under `harness_engineering` and the tool name under `tools`. Extensions that only shape output or add flags need no `tools` change.

`claude_code` maps the roster names onto Claude Code tools and drops `ls` (Bash covers it). Any other name is passed through unchanged, so a roster can name `WebSearch`, `Task`, or an MCP tool directly:

| Roster name | `--allowedTools` |
|---|---|
| `read` | `Read` |
| `bash` | `Bash` |
| `edit` | `Edit` |
| `write` | `Write` |
| `grep` | `Grep` |
| `find` | `Glob` |
| `ls` | dropped |

## Harness engineering

`harness_engineering` entries are pi extension file paths, passed as `pi -e <path>`, one flag per entry, scoped to that agent. The stamped `adws/adw_data/harness_engineering/subagents.ts` registers `subagent_create`, `subagent_continue`, `subagent_list`, and `subagent_remove`, wired to the planner and scout. For `claude_code`, entries are MCP config JSON files passed as `--mcp-config` (one flag per entry, then `--strict-mcp-config`); a non-`.json` path fails `validate()`.

## Write permissions

`tools` cannot express a safety boundary: `bash` runs anything, including `git checkout`, and `write` reaches any path. `adw_modules/permissions.ts` keeps the boundary after the fact. Before an agent's first prompt the working tree's change-set is fingerprinted; after its last send, including JSON retries and gate corrections, it is fingerprinted again. Any path that appeared, vanished, or changed is attributed to the agent. Comparing change-sets rather than watching writes is what catches a reversion such as `git checkout`.

A breach is not a gate violation, because the write has already happened:

1. Every unauthorized change the agent introduced is rolled back: tracked files with `git checkout --`, untracked files by deletion.
2. A path that was already dirty before the agent ran is left alone. The operator's uncommitted work is not collateral.
3. The phase fails and names every path with what happened to it.

```yaml
defaults:
  protected_files: [adws/adw_modules/, adws/adw_sssf_config/, "adws/adw_*.ts"]

agents:
  - name: builder      # no writes key: unrestricted, minus protected_files
  - name: scout
    writes: []         # no repo writes; its findings still land in context_handoff/
  - name: planner
    writes: [specs/]
  - name: documenter
    writes: [app_docs/, docs/, "**/*.md", "*.md"]
```

`writes` semantics: omitted means unrestricted apart from `protected_files`; `[]` means no repo writes; a list allows only those patterns. A trailing `/` is a directory prefix, `*` matches within one path segment, `**` crosses segments, `?` matches one character, anything else is an exact path. Naming a `protected_files` path in `writes` unlocks it for that agent.

The session runtime under `data_dir` is always writable for every agent. `context_handoff/`, prompts, `raw_output.jsonl`, and `envelope.json` live there, and an agent's ability to record its own work does not depend on a gitignore line. `writes: []` means read-only with respect to the repo, never mute.

Narrow by role, not by reflex. An agent that must produce a `context_handoff/` artifact needs `write`. Withhold `edit` where the restriction is the guarantee: a reviewer that cannot edit cannot quietly fix what it was asked to report.
