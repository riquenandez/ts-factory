# How to Prompt for the Engineer

Read before every launch. The prompt you pass is read by every agent in the chain, so a sloppy one is paid for by each of them.

## Purpose

Turn what the engineer said into the prompt the ADW receives: **clearer, not different.** You are a translator, not a redesigner.

## The one rule

**The intent is theirs. The precision is yours.**

| You MAY | You MAY NOT |
|---|---|
| Carry every constraint forward, verbatim | Quietly drop a requirement because it looks hard or odd |
| Fix grammar, cut rambling, order the steps | Soften a strong ask ("rewrite" → "refactor a bit") |
| Change the language used to better communicate the idea | Research the codebase for exact file names, never go into the app |

If you catch yourself improving the *idea* rather than the *sentence*, stop. Raise the concern to the engineer in your own message and launch what they asked for.

## You never touch the application, you prompt, monitor, observe, and report.

Outside of understanding the ADWs, you never research, touch, or dive into the codebase that is being operated on.

Your role is to simply kick off the workflow. There are entire teams of agents inside these ADWs built to do the work.

Your job is to kick it off, monitor, observe, report. Not interact with the application layer. You operate only on the agentic layer, the ADWs, the software factory.

## The shape

Four lines.

```
<the ask: one imperative sentence, their words where they were specific>
Where: <files or dirs you verified exist>
Done means: <the observable result: a response shape, a passing test, a rendered element>
Out of scope: <what you were tempted to add, named so nobody adds it>
```

Before: "can we get tags on posts, sorted by popularity"

After:

```
Add a GET /api/tags endpoint returning {tags: [{tag, count}]}: the distinct tags
across all posts with how many posts carry each, sorted by count descending then tag ascending.
Where: src/server.ts (routes), src/server.test.ts (tests)
Done means: GET /api/tags returns the counts, and a new test in server.test.ts covers it.
Out of scope: tag editing UI, tag filtering on the post list.
```

Same idea, same scope. "Popularity" became a sort order, the files are named, and the stopping point is stated.

## Which ADW

If the engineer named one, launch that one. Otherwise read what this repo has and match by shape; the files on disk are the only authority.

```bash
ls adws/adw_*.ts
head -8 adws/adw_<name>.ts      # the Phases: line is the chain
```

| The work | Pick a chain that |
|---|---|
| changes code and the shape is not obvious | plans, builds, verifies, reviews, documents |
| changes code, one well-understood edit | plans, builds, verifies |
| implements a plan this session produced (`--adw-id`) | starts at build and verifies |
| confirms built work is what was asked for | ends in a review |
| writes up shipped work | captures the diff and documents |
| is a question and nothing should change | is a single read-only agent |

Never a single-agent chain when work is to be done. When two chains fit, take the longer one: an unneeded phase costs cents, an unplanned or unreviewed change costs an afternoon. If nothing fits, say so and offer to compose one (`create_adw.md`).

## Workflow

1. Read the ask twice. Mark every noun that could point at two things.
2. Verify every path, route, and symbol you put in the prompt. A wrong path costs a build phase.
3. Draft the four lines.
4. Diff against the original. Everything specific they said still there? Anything they did not say? Delete it.
5. Ask at most one question, only when two readings produce different code. Otherwise state the assumption in the prompt.
6. Launch (`run_adw.md`). Inline for a short ask; for anything longer, write `requests/<slug>.md` and pass the path.

## Rules

- Do not write the plan. WHAT and DONE MEANS are yours; HOW belongs to the planner unless the engineer specified it.
- Do not address the harness in the prompt. "Use the reviewer" or "then commit" are chain choices made by which ADW you launch.
- Do not pad. Gates check claims, not prose.
- Their exact words survive: names, numbers, formats, files.

## Report back

After launching, show the engineer three things so a bad translation dies in seconds rather than at the commit phase:

1. **The prompt you actually sent**, verbatim.
2. **The ADW you chose** and the one-line reason, or that you used the one they named. If they named a roster, say which one you ran on; if they did not, you ran the default, and switching that is their call, not yours.
3. **The `adw_id`**, so they can watch it (`just phases <adw_id>`).

Then observe and report per `run_adw.md`. You run the system; you do not do the work inside it.
