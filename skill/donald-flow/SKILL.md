---
name: donald-flow
description: Report what you are doing to Donald so a person can watch it as a live graph. Use whenever you run a multi-step task that someone is observing - anything with a plan, several steps, tool calls, or subagents. Triggers on - show your work, visualize the flow, track this run, someone is watching, report progress, live graph, donald.
---

# Reporting your flow to Donald

Donald draws what you are doing as a live graph while you do it. Someone is
watching that graph. Your job is to keep it honest and current.

Report through the Donald MCP tools. If they are not available to you, carry on
with the task normally and do not mention it.

## The loop

```
start_run                          once, first
declare_actions                    once, straight after
  for each step:
    start_action
    report_progress                as often as useful
    complete_action | fail_action | skip_action
    check_instructions
finish_run                         once, last
```

## Three things that actually matter

**1. Invent a node_key per step and never change it.**
Lower_snake_case, unique within the run: `fetch_invoices`, `reconcile_totals`.
Every call about that step uses that exact key. This is the single most common
way this goes wrong - you declare `fetch_invoices`, then later call
`complete_action` with `fetch_invoice` or `fetchInvoices` and it fails.

If you have lost track of the keys you used, call `get_graph`. Do not guess, and
do not invent a new key for a step that already exists.

**2. Report as things happen, not at the end.**
A run reported in one batch when you finish is worthless - the graph sits empty
while the person waits, then fills in all at once. The point is that they see it
unfold. Call the tools at the moment each thing actually occurs.

**3. Declare the plan up front.**
`declare_actions` is the highest-value call you make: it puts the whole shape of
the work on screen before any of it runs, so the person can see where you are
heading and stop you early if it is wrong.

The plan is not binding. Discovered more work? `add_action`. Planned something
you no longer need? `skip_action` - do not leave it hanging, or it sits there
looking like work still to come. A step that depends on two earlier steps?
`add_dependency`.

## Someone may interrupt you

`check_instructions` between steps. It is almost always empty; carry on.

If it returns a **stop**, wind up cleanly - do not start new work. If it returns
a **steer**, follow it. Either way call `resolve_instruction` afterwards saying
what you did, or whether you could not. Until you do, the person who clicked the
button cannot tell whether you heard them.

## Attaching results

`attach_artifact` puts a link or a short text result beside a step. For files,
upload through the storage API first and pass the resulting URL - do not try to
push file contents through the tool call.

## Never report secrets

Summaries, progress lines and artifact text are displayed on screen and stored.
Never put credentials, tokens, API keys or personal data in them. Describe what
you did with a credential, never the credential.

## Worked example

A three-step run, reported the way it should be:

```
start_run(run_key="sess_8f21", name="Reconcile March invoices",
          summary="Pull invoices from the billing API, match against the ledger, flag mismatches")

declare_actions(run_key="sess_8f21", actions=[
  {node_key: "fetch_invoices",   name: "Fetch invoices"},
  {node_key: "match_ledger",     name: "Match against ledger", after: "fetch_invoices"},
  {node_key: "flag_mismatches",  name: "Flag mismatches",      after: "match_ledger"},
])

start_action(run_key="sess_8f21", node_key="fetch_invoices")
report_progress(run_key="sess_8f21", node_key="fetch_invoices", message="fetched 412 of 1,200", percent=34)
complete_action(run_key="sess_8f21", node_key="fetch_invoices", output_summary="1,200 invoices")
check_instructions(run_key="sess_8f21")

... and so on, then:

finish_run(run_key="sess_8f21", status="succeeded")
```

Note what `run_key` is: something stable you already have, like your session or
thread id. Reuse it in every call. If you call `start_run` twice with the same
key you resume the same run rather than starting a second one, which is what you
want after losing context.

## When a step fails

`fail_action` needs a real reason - "failed" tells the watcher nothing. Say what
broke. Then decide whether the run can continue: if it can, carry on with the
remaining steps; if it cannot, call `finish_run` with `status="failed"` rather
than leaving the graph frozen mid-run.

A run nobody ever finishes looks identical to an agent that crashed.
