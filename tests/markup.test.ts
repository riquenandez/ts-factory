import { describe, expect, test } from "bun:test";
import { escape, panel, render } from "../.claude/skills/sssf/factory/adws/adw_modules/compat/markup.ts";

describe("markup vs live rich", () => {
  test("plain session line", () => {
    const markup = "[bold cyan]adw_id:[/bold cyan] [bold]abcd1234[/bold]   [dim]engineer[/dim] Enrique";
    expect(render(markup, false).ansi + "\n").toBe("adw_id: abcd1234   engineer Enrique\n");
  });

  test("plain panel", () => {
    const rows = [
      " [dim]status[/dim]   [green]✓ success[/green]",
      " [dim]phases[/dim]   1/1 passed",
      " [dim]tokens[/dim]   41,233",
      " [dim]cost[/dim]     $0.0181",
      " [dim]adw_id[/dim]   abcd1234",
      " [dim]db[/dim]       adws/adw_data/sssf.db",
      " [dim]next[/dim]     [bold]just phases abcd1234[/bold]",
    ];
    const got = panel(rows.join("\n"), {
      title: "[bold]ADW complete[/bold]",
      borderStyle: "green",
      color: false,
    });
    expect(got.plain).toBe(
      "╭───────── ADW complete ──────────╮\n" +
        "│  status   ✓ success             │\n" +
        "│  phases   1/1 passed            │\n" +
        "│  tokens   41,233                │\n" +
        "│  cost     $0.0181               │\n" +
        "│  adw_id   abcd1234              │\n" +
        "│  db       adws/adw_data/sssf.db │\n" +
        "│  next     just phases abcd1234  │\n" +
        "╰─────────────────────────────────╯\n",
    );
  });

  test("escaped brackets in dynamic text match rich", () => {
    const markup = `limited to ${escape("[claimed]")}`;
    expect(render(markup, false).ansi + "\n").toBe("limited to [claimed]\n");
  });
});
