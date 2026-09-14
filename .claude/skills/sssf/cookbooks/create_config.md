# Create Config

Generate `adws/adw_sssf_config/sssf.config.yaml`, the agent roster.

```bash
bun .claude/skills/sssf/scripts/makeConfig.ts
```

Writes the starter roster (planner, builder, scout, reviewer, documenter) wired to the prompt files `/sssf install` stamped. Refuses to overwrite without `--force`. Retuning an existing roster is a hand edit: `update_config.md`.

## The rule

One agent, one prompt, one purpose. An entry says who an agent is: coding agent, model, thinking, one system prompt, one user prompt, what it may write. How it is used, the output type and any per-call prompt, lives at the ADW call site.

## Minimal shape

```yaml
defaults:
  coding_agent: pi                 # v1: pi only
  model: google/gemini-3.6-flash   # always provider/model-id; a bare id is ambiguous and refused
  thinking: medium                 # off | minimal | low | medium | high | xhigh | max
  tools: [read, bash, edit, write, grep, find, ls]   # pi's seven builtins; grep/find/ls are off in bare pi
  protected_files: [adws/adw_modules/, adws/adw_sssf_config/, "adws/adw_*.ts"]
  data_dir: adws/adw_data

observability:
  db: adws/adw_data/sssf.db

agents:
  - name: scout
    purpose: Find and report where things live; change nothing.
    prompt_engineering:
      system: adws/adw_data/prompt_engineering/scout/system.md
      user: adws/adw_data/prompt_engineering/scout/user.md
    writes: []                     # read-only in the repo; context_handoff/ is always writable
    tools: [read, grep, find, ls, bash, write]
```

Every entry merges over `defaults`, so it states only what differs. `harness_engineering` entries are pi extension file paths, and any tool an extension registers must also be named in that agent's `tools`.

## After generating

1. Each agent's `system.md` and `user.md` must exist on disk. `agents.validate()` fails at startup otherwise.
2. `purpose` and the system prompt's Purpose should say the same thing.
3. Run the smallest ADW that names your agents. A bad entry fails before anything spawns.

Full field spec, merging, model resolution, tools, and write permissions: `references/config.md`.
