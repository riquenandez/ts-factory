# Update Config

Add or retune agents in `adws/adw_sssf_config/sssf.config.yaml`. Full field spec: `references/config.md`.

## Retune model or thinking

```yaml
  - name: builder
    model: google/gemini-3.6-flash   # always provider/model-id
    thinking: high                   # off | minimal | low | medium | high | xhigh | max
```

A bare model id can match several providers and `agents.validate()` refuses it. Thinking only applies to models registered with `reasoning: true` in `~/.pi/agent/models.json`.

**A model change starts a fresh session.** `agent_map.json` records the model each session was created with. A joined run (`--adw-id`) whose config now names a different model starts that agent cold instead of resuming. Thinking changes do not invalidate a session.

## Recolor a lane

`color: "#22d3ee"` on the agent. Cosmetic, safe to change any time; the visualizer picks it up on the next run.

## Retune tools

Pi's seven builtins: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. The last three are off in bare pi, so name them or the agent shells out through `bash` to search.

Resolution: the agent's own list wins, else `defaults.tools`, else all tools. An empty list is a tool-less agent, not "all tools".

Narrow by role. Any agent that must write a `context_handoff/` artifact needs `write`. Withhold `edit` where the restriction is the guarantee, as with the reviewer. `tools` is a capability list; `writes` is the boundary (SKILL.md rule 9).

## Add a harness extension

```yaml
  - name: reviewer
    harness_engineering:
      - adws/adw_data/harness_engineering/ast_query.ts   # a pi extension file path; registers tool ast_query
    tools:
      - read
      - bash
      - ast_query                                        # required, or the tool is silently filtered out
```

`--tools` filters extension tools like builtins. Once an agent has any `tools` list, its own or inherited, a tool registered by an extension is dropped unless named. Nothing errors; the tool is just never offered. Adding a tool-registering extension is therefore a two-part edit.

## Add an agent

All three steps, or `agents.validate()` fails at startup:

1. **Prompts.** `adws/adw_data/prompt_engineering/<name>/system.md` (Purpose and Instructions, the static identity) and `user.md` (an h3 per input: `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`; the task; a `## Report` section showing the exact output JSON). Copy an existing pair.
2. **Config entry.** `name`, `purpose`, prompt refs, and whatever differs from `defaults`.
3. **Output type.** If none of the starter types fits, add one in `dataTypes.ts` (`update_modules.md`). The `## Report` example must match it exactly.

Then name the agent in an ADW's `REQUIRED_AGENTS` and call it.

## Rules

- ADWs name agents, never models. Swapping a model is a config edit.
- One agent, one prompt, one purpose. Two purposes means two agents.
- Output types never appear in config. They live at the call site.
