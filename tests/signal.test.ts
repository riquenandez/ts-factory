import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCleanup, runCleanups } from "../.claude/skills/sssf/factory/adws/adw_modules/runner.ts";
import { stampAdapter } from "./harness.ts";
import { stampAdw } from "./runAdw.ts";

const REPO_EXEC = join(import.meta.dir, "fixtures/repo_exec");
const REPO_COPILOT = join(import.meta.dir, "fixtures/repo_copilot");
const COPILOT = join(import.meta.dir, "fixtures/fake_copilot/copilot.ts");
const EXEC_JSONL = join(import.meta.dir, "fixtures/fake_exec/generic_ok.jsonl");
const COPILOT_JSONL = join(import.meta.dir, "fixtures/fake_copilot/generic_ok.jsonl");

async function waitForAgentPid(dbPath: string, adwId: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(dbPath)) {
      try {
        const db = new Database(dbPath);
        try {
          db.exec("PRAGMA busy_timeout=5000;");
          const row = db
            .query("SELECT pid FROM processes WHERE adw_id=? AND kind='agent' AND ended_at IS NULL")
            .get(adwId) as { pid: number } | null;
          if (row?.pid) return row.pid;
        } finally {
          db.close();
        }
      } catch {
        /* db not ready */
      }
    }
    await Bun.sleep(50);
  }
  throw new Error("timed out waiting for live agent process");
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`);
}

function spawnAdw(dir: string, env: Record<string, string>) {
  return Bun.spawn(["bun", "adws/adw_prompt.ts", "x", "--agent", "scout", "--adw-id", "abcd1234"], {
    cwd: dir,
    env: { ...process.env, ENGINEER_NAME: "enrique", PYTHONDONTWRITEBYTECODE: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("signalDoor", () => {
  test("exec child dies with the ADW", async () => {
    const dir = stampAdw(REPO_EXEC, { prepare: stampAdapter });
    const dbPath = join(dir, "adws/adw_data/sssf.db");
    const adw = spawnAdw(dir, {
      FAKE_SLEEP_SECONDS: "30",
      FAKE_EXEC_JSONL: EXEC_JSONL,
    });
    const stdoutP = new Response(adw.stdout).text();
    const stderrP = new Response(adw.stderr).text();
    try {
      const pid = await waitForAgentPid(dbPath, "abcd1234", 20_000);
      adw.kill("SIGTERM");
      expect(await adw.exited).toBe(143);
      await waitUntilDead(pid, 5_000);
      const db = new Database(dbPath);
      try {
        const live = db
          .query("SELECT COUNT(*) AS n FROM processes WHERE adw_id='abcd1234' AND ended_at IS NULL")
          .get() as { n: number };
        expect(live.n).toBe(0);
        const session = db.query("SELECT status FROM sessions WHERE adw_id='abcd1234'").get() as {
          status: string;
        };
        expect(session.status).toBe("fail");
      } finally {
        db.close();
      }
    } finally {
      try {
        adw.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      await stdoutP;
      await stderrP;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("copilot cleanup runs on a signal", async () => {
    const home = mkdtempSync(join(tmpdir(), "sssf-copilot-home-"));
    const dir = stampAdw(REPO_COPILOT);
    const dbPath = join(dir, "adws/adw_data/sssf.db");
    const adw = spawnAdw(dir, {
      FAKE_SLEEP_SECONDS: "30",
      COPILOT_PATH: COPILOT,
      COPILOT_HOME: home,
      FAKE_COPILOT_JSONL: COPILOT_JSONL,
    });
    const stdoutP = new Response(adw.stdout).text();
    const stderrP = new Response(adw.stderr).text();
    try {
      await waitForAgentPid(dbPath, "abcd1234", 20_000);
      adw.kill("SIGTERM");
      expect(await adw.exited).toBe(143);
      const agentsDir = join(home, "agents");
      expect(existsSync(agentsDir) ? readdirSync(agentsDir) : []).toEqual([]);
    } finally {
      try {
        adw.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      await stdoutP;
      await stderrP;
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  test("registerCleanup returns an unregister; runCleanups is reverse, once, and swallows throws", () => {
    runCleanups();
    const order: string[] = [];
    const unregister = registerCleanup(() => order.push("a"));
    registerCleanup(() => order.push("b"));
    registerCleanup(() => {
      order.push("c");
      throw new Error("boom");
    });
    unregister();
    runCleanups();
    expect(order).toEqual(["c", "b"]);
    order.length = 0;
    runCleanups();
    expect(order).toEqual([]);
  });
});
