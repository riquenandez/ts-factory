import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensure } from "../../templates/adws/adw_modules/session.ts";
import { defaultConfig, type SSSFConfig } from "../../templates/adws/adw_modules/dataTypes.ts";

function cfgIn(dir: string): SSSFConfig {
  const cfg = defaultConfig();
  cfg.defaults.data_dir = join(dir, "adw_data");
  cfg.defaults.protected_files = [];
  cfg.observability.db = join(dir, "adw_data", "sssf.db");
  return cfg;
}

describe("session + phase", () => {
  test("engineer phase then finish(accepted=false) leaves phases success and session fail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sssf-run-"));
    const run = ensure(cfgIn(dir), "abcd1234");
    await run.phase(
      { name: "request", kind: "engineer", owner: run.engineer, description: "Capture the incoming ask" },
      (ph) => ph.log({ input: "add a health endpoint" }),
    );
    const code = run.finish({ accepted: false, reason: "suite remained red" });
    expect(code).toBe(1);
    const session = run.tracer.conn.query("SELECT status, request FROM sessions").get() as {
      status: string;
      request: string;
    };
    expect(session.status).toBe("fail");
    expect(session.request).toBe("add a health endpoint");
    const phase = run.tracer.conn.query("SELECT status, name FROM phases").get() as {
      status: string;
      name: string;
    };
    expect(phase.status).toBe("success");
    expect(phase.name).toBe("request");
    const notAccepted = run.tracer.conn.query(
      "SELECT name FROM events WHERE type='error' AND name='not_accepted'",
    ).get();
    expect(notAccepted).toBeTruthy();
    run.tracer.conn.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a throw inside a phase finalizes the session and does not need finish()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sssf-run-"));
    const run = ensure(cfgIn(dir), "deadbeef");
    await expect(
      run.phase(
        { name: "quality", kind: "code", owner: "quality", description: "Run the deterministic quality blocks" },
        () => {
          throw new Error("quality failed: test");
        },
      ),
    ).rejects.toThrow("quality failed: test");
    const session = run.tracer.conn.query("SELECT status FROM sessions").get() as { status: string };
    expect(session.status).toBe("fail");
    const phase = run.tracer.conn.query("SELECT status, error FROM phases").get() as {
      status: string;
      error: string;
    };
    expect(phase.status).toBe("fail");
    expect(phase.error).toBe("quality failed: test");
    run.tracer.conn.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
