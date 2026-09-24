import type { EnvelopeBase, GateReport, Phase } from "./dataTypes.ts";
import type { Tracer } from "./tracer.ts";

const ANSI: Record<string, string> = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  white: "\x1b[37m",
};
const RESET = "\x1b[0m";

export function escape(text: string): string {
  return text.replace(/\[/g, "\\[");
}

function nextSpecial(markup: string, from: number): number {
  for (let j = from; j < markup.length; j++) {
    if (markup[j] === "\\" && markup[j + 1] === "[") return j;
    if (markup[j] === "[") return j;
  }
  return -1;
}

function applyStyles(styles: string[], text: string, color: boolean): string {
  if (!color || styles.length === 0) return text;
  const codes = styles.map((s) => ANSI[s]).filter(Boolean);
  if (!codes.length) return text;
  return codes.join("") + text + RESET;
}

/** Render a rich-markup string to ANSI (TTY) and plain (log payload). */
export function render(markup: string, color = stdoutTty()): { ansi: string; plain: string } {
  let ansi = "";
  let plain = "";
  const stack: string[][] = [[]];
  let i = 0;
  while (i < markup.length) {
    if (markup[i] === "\\" && markup[i + 1] === "[") {
      ansi += "[";
      plain += "[";
      i += 2;
      continue;
    }
    if (markup[i] === "[") {
      const close = markup.indexOf("]", i);
      if (close === -1) {
        ansi += markup.slice(i);
        plain += markup.slice(i);
        break;
      }
      const body = markup.slice(i + 1, close);
      i = close + 1;
      if (body === "/") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (body.startsWith("/")) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const styles = body.split(/\s+/).filter(Boolean);
      stack.push(styles);
      continue;
    }
    const next = nextSpecial(markup, i);
    const chunk = next === -1 ? markup.slice(i) : markup.slice(i, next);
    plain += chunk;
    ansi += applyStyles(stack.at(-1) ?? [], chunk, color);
    i = next === -1 ? markup.length : next;
  }
  return { ansi, plain };
}

export function stdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex -- CSI SGR sequences start with ESC
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function panel(
  body: string,
  opts: { title: string; borderStyle: "green" | "red"; color?: boolean },
): { ansi: string; plain: string } {
  const color = opts.color ?? stdoutTty();
  const pad = 1;
  const lines = body.split("\n");
  const titlePlain = render(opts.title, false).plain;
  const renderedLines = lines.map((line) => render(line, color));
  const contentWidth = Math.max(0, ...renderedLines.map((l) => visibleWidth(l.ansi)));
  const inner = Math.max(contentWidth + pad * 2, titlePlain.length + 2);
  const titleShown = render(opts.title, color);
  const side = inner - titlePlain.length - 2;
  const left = Math.max(0, Math.floor(side / 2));
  const right = Math.max(0, side - left);
  const border = color ? (opts.borderStyle === "green" ? "\x1b[32m" : "\x1b[31m") : "";
  const reset = color ? RESET : "";
  const top = `${border}╭${"─".repeat(left)} ${reset}${titleShown.ansi}${border} ${"─".repeat(right)}╮${reset}`;
  const topPlain = `╭${"─".repeat(left)} ${titlePlain} ${"─".repeat(right)}╮`;
  const mid: string[] = [];
  const midPlain: string[] = [];
  for (const line of renderedLines) {
    const fill = inner - pad * 2 - visibleWidth(line.ansi);
    const rightSpaces = pad + Math.max(0, fill);
    mid.push(`${border}│${reset}${" ".repeat(pad)}${line.ansi}${" ".repeat(rightSpaces)}${border}│${reset}`);
    const fillPlain = inner - pad * 2 - line.plain.length;
    midPlain.push(`│${" ".repeat(pad)}${line.plain}${" ".repeat(pad + Math.max(0, fillPlain))}│`);
  }
  const bot = `${border}╰${"─".repeat(inner)}╯${reset}`;
  const botPlain = `╰${"─".repeat(inner)}╯`;
  return {
    ansi: [top, ...mid, bot].join("\n") + "\n",
    plain: [topPlain, ...midPlain, botPlain].join("\n") + "\n",
  };
}

const KIND_COLOR: Record<string, string> = { engineer: "cyan", agent: "magenta", code: "yellow" };
const MAX_LINE = 160;

function _clip(text: string, limit = MAX_LINE): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : collapsed.slice(0, limit - 1) + "…";
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
      ` [dim]tokens[/dim]   ${tokens.toLocaleString("en-US")}`,
      ` [dim]cost[/dim]     $${cost.toFixed(4)}`,
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
      `${passed}/${this.results.length} phases · ${tokens.toLocaleString("en-US")} tokens · $${cost.toFixed(4)}`;
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
    let line = `  ${ok ? "[green]✓[/green]" : "[red]✗[/red]"} ${escape(phase.params.name)} [dim]${seconds.toFixed(1)}s[/dim]`;
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
    this._emit(`  [dim]└ ${escape(name)} used ${tokens.toLocaleString("en-US")} tokens · $${cost.toFixed(4)}[/dim]`);
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
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}
