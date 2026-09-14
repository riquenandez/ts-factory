import { pyLen } from "./format.ts";

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
  return pyLen(text.replace(/\x1b\[[0-9;]*m/g, ""));
}

export function panel(
  body: string,
  opts: { title: string; borderStyle: "green" | "red"; color?: boolean },
): { ansi: string; plain: string } {
  const color = opts.color ?? stdoutTty();
  const pad = 1;
  const lines = body.split("\n");
  const title_plain = render(opts.title, false).plain;
  const rendered_lines = lines.map((line) => render(line, color));
  const content_width = Math.max(0, ...rendered_lines.map((l) => visibleWidth(l.ansi)));
  const inner = Math.max(content_width + pad * 2, title_plain.length + 2);
  const title_shown = render(opts.title, color);
  const side = inner - title_plain.length - 2;
  const left = Math.max(0, Math.floor(side / 2));
  const right = Math.max(0, side - left);
  const border = color ? (opts.borderStyle === "green" ? "\x1b[32m" : "\x1b[31m") : "";
  const reset = color ? RESET : "";
  const top = `${border}╭${"─".repeat(left)} ${reset}${title_shown.ansi}${border} ${"─".repeat(right)}╮${reset}`;
  const top_plain = `╭${"─".repeat(left)} ${title_plain} ${"─".repeat(right)}╮`;
  const mid: string[] = [];
  const mid_plain: string[] = [];
  for (const line of rendered_lines) {
    const fill = inner - pad * 2 - visibleWidth(line.ansi);
    const right_spaces = pad + Math.max(0, fill);
    mid.push(`${border}│${reset}${" ".repeat(pad)}${line.ansi}${" ".repeat(right_spaces)}${border}│${reset}`);
    const fill_plain = inner - pad * 2 - pyLen(line.plain);
    mid_plain.push(`│${" ".repeat(pad)}${line.plain}${" ".repeat(pad + Math.max(0, fill_plain))}│`);
  }
  const bot = `${border}╰${"─".repeat(inner)}╯${reset}`;
  const bot_plain = `╰${"─".repeat(inner)}╯`;
  return {
    ansi: [top, ...mid, bot].join("\n") + "\n",
    plain: [top_plain, ...mid_plain, bot_plain].join("\n") + "\n",
  };
}
