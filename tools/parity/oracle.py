#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "pyyaml", "rich"]
# ///
"""Live Python oracle for the TS port. Prints a JSON object on stdout."""

from __future__ import annotations

import json
import sys
from pathlib import Path

GOLD = Path(__file__).resolve().parent / "python-gold" / "templates" / "adws"
sys.path.insert(0, str(GOLD))

from pydantic import ValidationError  # noqa: E402
from adw_modules.data_types import (  # noqa: E402
    BuildOutput,
    EventRecord,
    GenericOutput,
    ScoutOutput,
)


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "dump"
    if cmd == "json":
        payload = json.loads(sys.argv[2])
        indent = int(sys.argv[3]) if len(sys.argv) > 3 else None
        print(json.dumps(payload, indent=indent), end="")
        return 0
    if cmd == "serde":
        obj = GenericOutput.model_validate(json.loads(sys.argv[2]))
        print(obj.model_dump_json(indent=2), end="")
        return 0
    if cmd == "validate":
        raw = json.loads(sys.argv[2])
        name = sys.argv[3] if len(sys.argv) > 3 else "GenericOutput"
        cls = {"GenericOutput": GenericOutput, "BuildOutput": BuildOutput, "ScoutOutput": ScoutOutput}[name]
        try:
            cls.model_validate(raw)
            print(json.dumps({"ok": True}))
        except (ValidationError, Exception) as e:
            print(json.dumps({"ok": False, "error": str(e)}))
        return 0
    if cmd == "event_dump":
        rec = EventRecord(adw_id="abcd1234", type="log")
        print(json.dumps(rec.model_dump()), end="")
        return 0
    if cmd == "yaml":
        import yaml
        print(json.dumps(yaml.safe_load(sys.argv[2])))
        return 0
    if cmd == "shlex":
        import shlex
        print(shlex.join(json.loads(sys.argv[2])), end="")
        return 0
    if cmd == "format":
        n = float(sys.argv[2])
        kind = sys.argv[3]
        if kind == "comma":
            print(f"{int(n):,}", end="")
        elif kind == "cost":
            print(f"{n:.4f}", end="")
        elif kind == "sec":
            print(f"{n:.1f}", end="")
        elif kind == "bool":
            print(str(n != 0), end="")
        return 0
    if cmd == "markup":
        from rich.console import Console
        from rich.text import Text
        import io
        markup = sys.argv[2]
        color = sys.argv[3] != "plain" if len(sys.argv) > 3 else True
        buf = io.StringIO()
        c = Console(file=buf, force_terminal=color, highlight=False, soft_wrap=True, width=80)
        c.print(Text.from_markup(markup))
        sys.stdout.write(buf.getvalue())
        return 0
    if cmd == "panel":
        from rich.console import Console
        from rich.panel import Panel
        from rich.text import Text
        import io
        color = sys.argv[2] != "plain" if len(sys.argv) > 2 else True
        rows = [
            " [dim]status[/dim]   [green]✓ success[/green]",
            " [dim]phases[/dim]   1/1 passed",
            " [dim]tokens[/dim]   41,233",
            " [dim]cost[/dim]     $0.0181",
            " [dim]adw_id[/dim]   abcd1234",
            " [dim]db[/dim]       adws/adw_data/sssf.db",
            " [dim]next[/dim]     [bold]just phases abcd1234[/bold]",
        ]
        panel = Panel(Text.from_markup("\n".join(rows)),
                      title="[bold]ADW complete[/bold]",
                      border_style="green", expand=False)
        buf = io.StringIO()
        c = Console(file=buf, force_terminal=color, highlight=False, soft_wrap=True, width=80)
        c.print(panel)
        sys.stdout.write(buf.getvalue())
        return 0
    print(f"unknown oracle command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
