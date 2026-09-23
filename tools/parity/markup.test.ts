import { describe, expect, test } from "bun:test";
import { escape, panel, render } from "../../.claude/skills/sssf/templates/adws/adw_modules/compat/markup.ts";
import { oracle } from "./harness.ts";

describe("markup vs live rich", () => {
  test("plain session line", async () => {
    const markup = "[bold cyan]adw_id:[/bold cyan] [bold]abcd1234[/bold]   [dim]engineer[/dim] Enrique";
    const gold = await oracle(["markup", markup, "plain"]);
    expect(render(markup, false).ansi + "\n").toBe(gold);
  });

  test("plain panel", async () => {
    const gold = await oracle(["panel", "plain"]);
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
    expect(got.plain).toBe(gold);
  });

  test("escaped brackets in dynamic text match rich", async () => {
    const markup = `limited to ${escape("[claimed]")}`;
    const gold = await oracle(["markup", markup, "plain"]);
    expect(render(markup, false).ansi + "\n").toBe(gold);
  });
});
