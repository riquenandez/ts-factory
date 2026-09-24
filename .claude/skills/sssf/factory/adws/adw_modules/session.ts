import { basename, parse } from "node:path";
import type { SSSFConfig } from "./agents.ts";
import { Run } from "./runner.ts";
import { Tracer } from "./tracer.ts";
import { engineerName, newId } from "./utils.ts";

function finalizeWhenKilled(run: Run): void {
  process.on("SIGTERM", () => run.signalDoor(15));
  process.on("SIGINT", () => run.signalDoor(2));
}

export function ensure(cfg: SSSFConfig, adwId: string | null = null): Run {
  const id = adwId || newId(8);
  const tracer = new Tracer(
    cfg.observability.db,
    `${cfg.defaults.data_dir}/sessions/${id}/events.jsonl`,
  );
  const run = new Run({ cfg, adwId: id, tracer, engineer: engineerName() });
  const script = process.argv[1] ?? "";
  tracer.sessionStart(id, run.engineer, parse(script).name);
  tracer.processStart(
    id,
    "adw",
    "",
    process.pid,
    [basename(script), ...process.argv.slice(2)].join(" "),
  );
  finalizeWhenKilled(run);
  run.console.sessionStarted(id, run.engineer);
  return run;
}
