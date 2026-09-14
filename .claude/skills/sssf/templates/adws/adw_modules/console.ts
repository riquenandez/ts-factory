import { collapseWhitespace, comma, fixed, pyHead, pyLen, pyStr } from "./compat/format.ts";
import { escape, panel, render } from "./compat/markup.ts";
import type { EnvelopeBase, GateReport, Phase } from "./dataTypes.ts";
import type { Tracer } from "./tracer.ts";

const KIND_COLOR: Record<string, string> = { engineer: "cyan", agent: "magenta", code: "yellow" };
const MAX_LINE = 160;

function _clip(text: string, limit = MAX_LINE): string {
  const collapsed = collapseWhitespace(text);
  return pyLen(collapsed) <= limit ? collapsed : pyHead(collapsed, limit - 1) + "…";
}

export class Console {
  phaseId = "";
  phaseName = "";
  results: string[] = [];
  private _finished = false;

  constructor(readonly tracer: Tracer, readonly adwId: string) {}

  private _emit(markup: string, level = "info", renderable?: { ansi: string }): void {
    const text = render(markup);
    process.stdout.write(renderable ? renderable.ansi : text.ansi + "\n");
    this.tracer.event({
      adw_id: this.adwId,
      phase_id: this.phaseId,
      type: "log",
      name: this.phaseName || "console",
      payload: { message: text.plain, level },
    });
  }

  sessionStarted(adwId: string, engineer: string): void {
    this._emit(
      `[bold cyan]adw_id:[/bold cyan] [bold]${escape(adwId)}[/bold]` +
        `   [dim]engineer[/dim] ${escape(engineer)}`,
    );
  }

  sessionFinished(ok: boolean, tokens: number, cost: number, dbPath: string): void {
    if (this._finished) return;
    this._finished = true;
    const passed = this.results.filter((r) => r === "success").length;
    const status = ok ? "[green]✓ success[/green]" : "[red]✗ fail[/red]";
    const rows = [
      ` [dim]status[/dim]   ${status}`,
      ` [dim]phases[/dim]   ${passed}/${this.results.length} passed`,
      ` [dim]tokens[/dim]   ${comma(tokens)}`,
      ` [dim]cost[/dim]     $${fixed(cost, 4)}`,
      ` [dim]adw_id[/dim]   ${escape(this.adwId)}`,
      ` [dim]db[/dim]       ${escape(dbPath)}`,
      ` [dim]next[/dim]     [bold]just phases ${escape(this.adwId)}[/bold]`,
    ];
    const box = panel(rows.join("\n"), {
      title: "[bold]ADW complete[/bold]",
      borderStyle: ok ? "green" : "red",
    });
    const plain =
      `session ${this.adwId} ${ok ? "success" : "fail"} · ` +
      `${passed}/${this.results.length} phases · ${comma(tokens)} tokens · $${fixed(cost, 4)}`;
    this._emit(escape(plain), ok ? "info" : "error", box);
  }

  phaseStarted(phase: Phase): void {
    this.phaseId = phase.phase_id;
    this.phaseName = phase.params.name;
    const p = phase.params;
    const color = KIND_COLOR[p.kind] ?? "white";
    let line =
      `[bold ${color}]▶ ${String(phase.seq).padStart(2, "0")} ${escape(p.name)}[/bold ${color}]` +
      `  [${color}]${p.kind}[/${color}] [dim]· ${escape(p.owner)}[/dim]`;
    if (p.description) line += `  [dim]${escape(_clip(p.description))}[/dim]`;
    this._emit(line);
  }

  phaseEnded(phase: Phase, seconds: number): void {
    const ok = phase.status === "success";
    this.results.push(phase.status);
    let line = `  ${ok ? "[green]✓[/green]" : "[red]✗[/red]"} ${escape(phase.params.name)} [dim]${fixed(seconds, 1)}s[/dim]`;
    if (!ok && phase.error) line += `  [red]${escape(_clip(phase.error))}[/red]`;
    this._emit(line, ok ? "info" : "error");
    this.phaseId = "";
    this.phaseName = "";
  }

  note(message: string): void {
    this._emit(`  [dim]· ${escape(_clip(message))}[/dim]`);
  }

  agentStarted(name: string, model: string, sessionId: string): void {
    this._emit(
      `  [magenta]▸[/magenta] ${escape(name)} [dim]${escape(model)}[/dim]` +
        `  [dim]session ${escape(sessionId)}[/dim]`,
    );
  }

  agentFinished(name: string, tokens: number, cost: number): void {
    this._emit(`  [dim]└ ${escape(name)} used ${comma(tokens)} tokens · $${fixed(cost, 4)}[/dim]`);
  }

  retry(name: string, attempt: number, limit: number, reason: string): void {
    this._emit(
      `  [yellow]⟳[/yellow] ${escape(name)} retry ${attempt}/${limit} ` +
        `[dim]— same session · ${escape(_clip(reason))}[/dim]`,
      "warn",
    );
  }

  gateResult(name: string, report: GateReport): void {
    const ok = report.passed;
    const mark = ok ? "[green]✓[/green]" : "[red]✗[/red]";
    const summary = ok
      ? `${report.checks.length} checked`
      : `[red]${report.violations.length} of ${report.checks.length} failed[/red]`;
    this._emit(`  ${mark} gate [dim]${escape(name)}[/dim] [dim]${summary}[/dim]`, ok ? "info" : "error");
    for (const check of report.checks) {
      const style = check.ok ? "dim" : "dim red";
      const detail = check.note ? ` — ${_clip(check.note)}` : "";
      this._emit(
        `    [${style}]${check.ok ? "·" : "✗"} ${escape(_clip(check.item))}${escape(detail)}[/${style}]`,
        check.ok ? "info" : "error",
      );
    }
  }

  envelopeSummary(envelope: EnvelopeBase, typeName: string): void {
    const ok = envelope.status === "success";
    this._emit(
      `  ${ok ? "[green]✓[/green]" : "[red]✗[/red]"} ${typeName} [dim]${escape(_clip(envelope.summary))}[/dim]`,
      ok ? "info" : "error",
    );
    if (envelope.artifacts.length) {
      this._emit(`    [dim]artifacts: ${escape(_clip(envelope.artifacts.join(", ")))}[/dim]`);
    }
  }
}

/** `str(error)[:1000]`, the shape `phases.error` stores. */
export function errorText(error: unknown): string {
  return pyHead(error instanceof Error ? error.message : pyStr(error), 1000);
}
