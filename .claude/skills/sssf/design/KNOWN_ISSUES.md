# Known issues

These were preserved for parity with the Python original. They are no longer protected. Each is a candidate for a deliberate fix with a snapshot update.

- `permissions.enforce()` is skipped when parse retries exhaust or gates fail. The phase dies before the audit, so an agent that breached and wrote bad JSON is never reported as a breach, and the unauthorized file stays on disk.
- `tools: []` omits `--tools` entirely, so an agent with an empty allowlist gets every pi default.
- `quality.test()` reports `operation: "build"`, so a test block is stored as a build.
- The quality `tool_call` payload has no `ok` key, so the UI renders a failed quality block as fine.
- `parent_id` is always `""`, and no phase row is written with `status = 'queued'`, so nothing can express a parent event or a queued phase.
- `observability.poll_ms` is parsed and never read, so setting it changes nothing.
- `--adw-id` joins the session and continues `seq`, and does not hydrate `previous` from a prior `envelope.json`. A joined run's first agent call renders `previous_envelope` as `(none)`.
- `makeAdw` emits `return run.finish()` because `run.succeeded` is a compile error.
- The cwd is split: `gitHelper` runs git in the process cwd, `permissions` runs it in `repo_root`, and `gates.tests_pass` shells out with no cwd. A run started from a subdirectory sees three different directories.
- `session.ensure` writes the session row before the first phase, and `agents.validate` throws before `ensure`, so a bad config leaves no session row.
- Three finalization doors stay separate. A phase throw closes the session `fail` and re-raises (exit 1 and a stack trace). `SIGTERM` closes it `fail` and exits 143. `finish()` returns 0 or 1 and is the only door that prints the verdict banner. A throw must not be routed through `finish()`.
