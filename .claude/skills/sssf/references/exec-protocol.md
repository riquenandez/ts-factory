# Exec Protocol (`sssf-exec/1`)

The `coding_agent: exec` runtime runs an arbitrary command that speaks this stdin/stdout protocol. The command can live in another repository and be written in any language. An adapter is a few dozen lines; the fixture at `tests/fixtures/fake_exec/agent.ts` is the reference example.

Everything that makes a node trustworthy stays on the factory side. See [What the factory keeps](#what-the-factory-keeps).

## Invocation

The roster's `command` is an argv list. It is not inherited from `defaults`.

Validation runs `<command...> --check`. Exit 0 means ready. A non-zero exit fails `validate()` before any session row:

```
agent '<name>': exec command failed --check: <shlex-joined command> (<stderr tail 200>)
```

An empty `command` (or a list with a non-string token) fails with `exec runtime needs a non-empty command list`. There are no model, tools, or extension checks: those are the adapter's.

A send runs `<command...>` with no extra arguments.

- `cwd` is the repo root (`request.cwd`).
- `env` is `operatorEnv()` plus `SSSF_EXEC_PROTOCOL=sssf-exec/1`, `SSSF_SESSION_ID`, and `SSSF_SESSION_DIR`.
- If `command[0]` is a relative path containing a path separator, it is resolved against the repo root before spawning. A bare name resolves through `PATH`. An absolute path is left untouched.

## Request

One JSON object on stdin, then stdin is closed:

```json
{"protocol": "sssf-exec/1", "prompt": "...", "system_prompt": "...", "model": "...", "thinking": "medium",
 "session_id": "<uuid>", "session_dir": "/abs/path/<agent>/exec_sessions", "tools": ["read", "bash"] | null,
 "extensions": [], "cwd": "/abs/repo/root"}
```

Keys, exactly: `protocol`, `prompt`, `system_prompt`, `model`, `thinking`, `session_id`, `session_dir`, `tools`, `extensions`, `cwd`. There is no `raw_output_path`.

`tools`, `extensions`, `model`, and `thinking` are passed through verbatim from the roster; the adapter interprets them. `session_dir` exists, is writable, and is the same directory for every invocation with the same `session_id`; an adapter persists whatever it needs to continue a conversation there. The same `session_id` on a later invocation means continue.

JSON retries and gate corrections are further sends with the same `session_id`. The correction text is the new `prompt`; `system_prompt` is unchanged.

## Events

stdout is JSONL, one object per line. Every line is appended verbatim to `{agent}/raw_output.jsonl` and forwarded to the trace's event hook. Lines that fail to parse are ignored. Unknown `type` values are forwarded and otherwise ignored.

Defined types, all fields snake_case:

### `tool_call`

```json
{"type": "tool_call", "tool": "bash", "tool_call_id": "c1", "args": {"command": "echo hi"}, "ok": true, "result_snippet": "hi\n", "started_at": "<iso>", "ended_at": "<iso>", "duration_ms": 12, "label": "bash: echo hi"}
```

One per completed tool call. `tool`, `tool_call_id`, `args`, and `ok` are required; the rest are optional. The runtime clips string `args` values and `result_snippet` with `clip` and the shared limits (`ARG_VALUE_CHARS` / `RESULT_SNIPPET_CHARS`), fills `label` with `labelFor(tool, args)` when absent, and fills `ended_at` with `nowIso()` when absent. `started_at` and `duration_ms` are recorded only when supplied.

### `message`

```json
{"type": "message", "text": "..."}
```

Assistant text. The last non-empty `text` is the final response the harness parses as the envelope.

### `usage`

```json
{"type": "usage", "input": 100, "output": 20, "cache_read": 0, "cache_write": 0, "reasoning": 0, "cost": 0.0125}
```

Additive: each event adds to the totals. Missing fields count as 0. `total_tokens` is the sum of the four components (`input + output + cache_read + cache_write`); `reasoning` is recorded but not added.

### `context`

```json
{"type": "context", "tokens": 1200, "window": 200000}
```

Window occupancy after the last turn. Last wins.

### `error`

```json
{"type": "error", "message": "..."}
```

Recorded. Used in the thrown message when the run fails.

## Exit

0 is success. A non-zero exit with no message text throws `RuntimeError("exec exited N: <last error message, else stderr tail 800>")`. A non-zero exit with text returns the result, as the other runtimes do.

## Write an adapter

The command must handle two invocations.

**`--check`.** Exit 0 when the adapter is ready to receive a request. The factory does not set `SSSF_EXEC_PROTOCOL` on this call.

**A send.** Refuse to run unless `SSSF_EXEC_PROTOCOL` is `sssf-exec/1`. Read the request from stdin (then stdin is already closed), persist whatever you need under `session_dir` keyed by `session_id`, write JSONL events to stdout, exit 0 when the turn produced assistant text the harness can parse.

`tests/fixtures/fake_exec/agent.ts` is a complete adapter. `--check` is the ready probe; the protocol env is the send-path pin; `session_dir` holds a per-session call counter so a later send with the same `session_id` can continue:

```ts
if (process.argv.includes("--check")) {
  process.stdout.write("ok\n");
  const checkExit = Number(process.env.FAKE_EXEC_CHECK_EXIT ?? "0");
  process.exit(Number.isFinite(checkExit) ? checkExit : 0);
}

if (process.env.SSSF_EXEC_PROTOCOL !== "sssf-exec/1") {
  process.stderr.write(
    `fake_exec: SSSF_EXEC_PROTOCOL must be sssf-exec/1 (got ${process.env.SSSF_EXEC_PROTOCOL ?? ""})\n`,
  );
  process.exit(4);
}

const raw = await Bun.stdin.text();
let request: Record<string, unknown>;
try {
  request = JSON.parse(raw) as Record<string, unknown>;
} catch (error) {
  process.stderr.write(`fake_exec: invalid request JSON: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const sessionId = typeof request.session_id === "string" && request.session_id ? request.session_id : "unknown";
const sessionDir = typeof request.session_dir === "string" ? request.session_dir : "";
mkdirSync(sessionDir, { recursive: true });
const callsPath = join(sessionDir, `${sessionId}.calls`);
const previous = existsSync(callsPath) ? Number(readFileSync(callsPath, "utf8").trim()) : 0;
const callNumber = (Number.isFinite(previous) ? previous : 0) + 1;
writeFileSync(callsPath, String(callNumber));
```

A production adapter replaces the fixture's JSONL replay with a call to its own agent, then writes `tool_call` / `message` / `usage` / `context` / `error` lines as specified above.

Roster entry:

```yaml
  - name: scout
    coding_agent: exec
    model: any-model
    command:
      - bun
      - path/to/your/adapter.ts
    tools:
      - read
      - bash
```

A relative first token (`./tools/adapter.ts`) is resolved from the repo root. `bun` as a bare name resolves through `PATH`.

## What the factory keeps

The adapter does not parse envelopes, retry JSON, run gates, or enforce write permissions. Those stay in the factory regardless of which command `exec` spawns:

| Concern | Owner |
|---|---|
| Envelope typing against the call site's output type | `execute.ts` `parseWithRetries` |
| JSON retries in the same `session_id` | `execute.ts` `parseWithRetries` |
| Gates and gate corrections | `execute.ts` `execute` |
| Git-fingerprint permission boundary (`writes` / `protected_files`) | `permissions.ts` |
| The SQLite + JSONL trace | `tracer.ts` |

An adapter that emits a `message` whose text is not valid envelope JSON is re-prompted in the same session, the same way `pi`, `claude_code`, and `copilot` are. An adapter that writes outside `writes:` is rolled back the same way. The protocol is how the factory talks to the agent; it is not a way around the harness.
