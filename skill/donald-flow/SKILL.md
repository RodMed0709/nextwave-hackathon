---
name: donald-flow
description: Report what you are doing to Donald so a person can watch it as a live graph. Use whenever you run a multi-step task that someone is observing - anything with a plan, several steps, tool calls, or subagents. Triggers on - show your work, visualize the flow, track this run, someone is watching, report progress, live graph, donald.
---

# Reporting your flow to Donald

Donald draws what you are doing as a live graph while you do it. Someone is
watching that graph. Your job is to keep it honest and current.

Report through the Donald MCP tools. If they are not available to you, carry on
with the task normally and do not mention it.

## Share the link first

**start_run** returns a **watch_url**. Show it to the person immediately, before
any work starts:

> Follow along: https://usedonald.com/runs/<your-run-key>

Do this as the FIRST thing after starting the run. The graph is only useful to
someone who is looking at it while it happens — a link produced at the end is a
link nobody opened. The URL is built from your run_key, so it is stable and you
can share it before a single step has run.

## The loop

```
start_run                        once, first — SHOW the watch_url it returns
declare_actions                  once, straight after - your best guess at the plan
  as you work:
    start_action                 begins a step, and RESUMES a blocked or failed one
    report_progress              as often as useful
    then exactly one of:
      complete_action            it worked
      fail_action                something broke
      cancel_action              you had started it and abandoned it
      skip_action                you never started it and no longer will
      block_action               cannot proceed yet, waiting on someone/something
    add_action / add_dependency  whenever the plan grows
    check_instructions           between steps
finish_run                       once, last
```

Every step ends in exactly one of those five, or is still running. A step left
at not_started that you are never going to run is the most common way the graph
ends up lying — see below.

## Your plan WILL change. Keep the graph matching reality.

This is the part that goes wrong most often, so treat it as the main event, not
an afterthought. The plan you declare at the start is a guess made before you
saw any data. The moment reality differs, the graph is wrong until you say so —
and a wrong graph is worse than no graph, because the person watching believes it.

**You discover work that was not in the plan** → `add_action`, then `start_action`
on it as normal. This is expected and completely fine. It is not a failure to
have missed it; the whole design assumes you will. Use `after` (or
`add_dependency`) to say what it follows so it lands in the right place rather
than floating.

**A planned step turns out to be unnecessary** → `skip_action` with a reason.
Never leave it sitting at not_started: to the watcher that is indistinguishable
from work you are about to do, so they wait for something that will never happen.

**You already started a step and are abandoning it** → `cancel_action`. Not
`skip_action` (that claims you never began) and not `fail_action` (that blames
the work for your decision).

**Something actually broke** → `fail_action` with a real reason.

**You are stuck waiting, but nothing has failed** → `block_action`, with the
reason (`user_decision`, `missing_data` or `provider_outage`) and a line saying
exactly what you are waiting for. Do NOT keep posting progress to look busy: a
stuck run that looks busy is one nobody comes to rescue. Blocking the step also
marks the whole run as blocked, which is how someone scanning a list of runs
spots the one that needs them. When the block clears, `start_action` on the same
step resumes it.

**You are retrying a step that failed** → just `start_action` on it again. The
graph records the retry, and the old error is cleared. You do not need a new
node_key, and you should not invent one — a retry of `fetch_invoices` is still
`fetch_invoices`.

**The remaining plan is now wrong, not just one step** → fix it as a whole. Skip
the steps that no longer apply, add the ones that do, and wire dependencies with
`add_dependency`. Do this as soon as you know, not at the end.

Rules of thumb: if you are about to do something the graph does not show, add it
first. If the graph shows something you are not going to do, skip it now. If you
find yourself thinking "the graph is a bit out of date but I will fix it later",
fix it now — later usually means never, and the person is watching in the
meantime.

## Declaring the plan properly

Two fields carry more than they look like they do:

- **`agent_label`** — which agent runs the step ("Nina", "Theo"). This is what
  draws the swimlanes. Omit it and every step looks like it came from one
  anonymous worker, which is wrong whenever subagents are involved.
- **`depends_on: [...]`** — ALL the steps this one waits on. A step with three
  predecessors is a join and needs all three here. `after: "x"` is shorthand for
  exactly one. Declaring a join with one parent and adding the rest later leaves
  the graph briefly lying about its own shape.

Both are optional to the schema and load-bearing to the picture. Fill them in.

## Show the work inside a step

When a step has subtasks, declare them on `start_action` so the person watching
sees the whole checklist before work begins. Each item has a stable `key`, a
short English `label`, and a `status`: `pending`, `running`, `done`, `skipped`
or `failed` (`pending` is the default).

Every later `report_progress` sends the **complete ordered `subtasks` list**,
not only the item that changed. A full snapshot makes retries idempotent and
lets a caller that lost context resend the current truth without reconstructing
earlier deltas.

```
start_action(run_key="sess_8f21", node_key="approve_animation_slice", subtasks=[
  {key: "review_frames", label: "Review the key frames", status: "pending"},
  {key: "check_timing", label: "Check the transition timing", status: "pending"},
  {key: "approve_slice", label: "Approve the animation slice", status: "pending"},
])

report_progress(run_key="sess_8f21", node_key="approve_animation_slice",
  message="Key frames approved; checking timing", subtasks=[
    {key: "review_frames", label: "Review the key frames", status: "done"},
    {key: "check_timing", label: "Check the transition timing", status: "running"},
    {key: "approve_slice", label: "Approve the animation slice", status: "pending"},
  ])
```

## Say what the step would have cost a person

`complete_action` takes one more field worth the same care: **`manual_minutes`**,
how long that step would have taken a competent person doing it by hand, start to
finish. Wall-clock minutes, not effort — count the waiting on a reply, the
switching between systems, the second pass over a PDF to find the one field that
was missing. Pass it whenever you can put an honest number on it.

Be conservative and be honest. The number is recorded once, on the event that
completed the step, and shown from then on exactly as you gave it — nobody
recalculates it and you cannot revise it later. A figure that flatters the run is
worse than no figure at all, because the only thing that number is worth is being
believed.

Roughly, in this world:

| Step | `manual_minutes` |
|---|---|
| Reading an arrival notice and pulling the fields out of it | 8 |
| Rekeying a booking into a second system | 12 |
| Reconciling an invoice against a PO, line by line | 25 |
| Chasing a carrier by email and waiting for the reply | 45 |

If you genuinely cannot say — the step is bookkeeping, or you have no idea what
the manual equivalent even looks like — leave it out. An omitted estimate costs
nothing. A wild one is a claim that outlives the run.

## Two more things that matter

**Invent a node_key per step and never change it.**
Lower_snake_case, unique within the run: `fetch_invoices`, `reconcile_totals`.
Every call about that step uses that exact key. This is the most common way this
goes wrong — you declare `fetch_invoices`, then later call `complete_action` with
`fetch_invoice` and it fails.

Lost track of the keys you used? Call `get_graph`. Do not guess, and do not
invent a second key for a step that already exists.

**Report as things happen, not at the end.**
A run reported in one batch when you finish is worthless — the graph sits empty
while the person waits, then fills in all at once. The point is that they watch
it unfold.

## Someone may interrupt you

Every call you make returns **`pending_instructions`**. Zero — the usual case, and
the field is omitted entirely — means carry on. Non-zero means somebody is waiting
on you, so call `check_instructions` then. You do not have to poll blindly after
every step; the signal comes to you.

`check_instructions` is still there for an explicit check, and is worth calling at
a natural pause such as before a decision or an irreversible action.

If it returns a **stop**, wind up cleanly — `cancel_action` whatever you had
running, do not start new work, and `finish_run` with `status="cancelled"`. If it
returns a **steer**, follow it, which usually means changing the plan: skip what
no longer applies and add what does.

Either way call `resolve_instruction` afterwards saying what you did, or why you
could not. Until you do, the person who clicked the button cannot tell whether
you heard them.

The test is whether the graph moved. An instruction you acknowledge and then
carry on unaffected by is worse than one you ignored: the person sees their
button work, sees nothing change, and learns that the controls are decorative.
So make the change first and report it second — `cancel_action` or `skip_action`
for a stop, `add_action` (or a fresh `declare_actions`) for a redirect — and say
in `resolve_instruction` which steps you actually touched. If you decide you
cannot comply, that is a real answer and belongs there too. Silently continuing
is not.

## Attaching results

`attach_artifact` puts a link or a short text result beside a step. For files,
upload through the storage API first and pass the resulting URL — do not try to
push file contents through the tool call.

## When a call fails

Call **`health`** before concluding anything. A transport error looks identical
whether Donald is down or your run is broken, and `health` is what tells them
apart. If the database is unreachable, wait and retry the **same** call — every
mutation carries an idempotency key and will not double-apply.

Do not abandon a run on one failed call. `start_run` with the same `run_key`
resumes exactly where you left off, and `get_graph` shows you where that is. Do
not invent new node_keys on reconnect.

## Never report secrets

Summaries, progress lines and artifact text are displayed on screen and stored.
Never put credentials, tokens, API keys or personal data in them. Describe what
you did with a credential, never the credential.

## Worked example — including the plan changing under you

```
start_run(run_key="sess_8f21", name="Reconcile March invoices",
          summary="Pull invoices from the billing API, match against the ledger, flag mismatches")
→ {"ok": true, "watch_url": "https://usedonald.com/runs/sess_8f21", ...}

# Tell the person, right now, before doing anything else:
#   "Follow along: https://usedonald.com/runs/sess_8f21"

declare_actions(run_key="sess_8f21", actions=[
  {node_key: "fetch_invoices",  name: "Fetch invoices",       agent_label: "Nina"},
  {node_key: "fetch_ledger",    name: "Fetch ledger extract", agent_label: "Theo"},
  # A JOIN: give every predecessor in depends_on. Do NOT declare it with one
  # parent and patch the rest in later with add_dependency.
  {node_key: "match_ledger",    name: "Match against ledger", agent_label: "Theo",
   depends_on: ["fetch_invoices", "fetch_ledger"]},
  {node_key: "flag_mismatches", name: "Flag mismatches",      agent_label: "Marcus",
   after: "match_ledger"},
  {node_key: "email_summary",   name: "Email summary",        agent_label: "Nina",
   after: "flag_mismatches"},
])

start_action(run_key="sess_8f21", node_key="fetch_invoices")
report_progress(run_key="sess_8f21", node_key="fetch_invoices", message="fetched 412 of 1,200", percent=34)
# manual_minutes: pulling 1,200 invoices out of the billing UI by hand is most
# of a morning. Say so once, here, and it stays said.
complete_action(run_key="sess_8f21", node_key="fetch_invoices", output_summary="1,200 invoices",
                manual_minutes=90)

# The data turns out to be messier than expected: half the invoices are in EUR.
# That is a step nobody planned. Add it, wire it in, then do it.
add_action(run_key="sess_8f21", node_key="normalize_currency",
           name="Normalize currency", after="fetch_invoices")
add_dependency(run_key="sess_8f21", from="normalize_currency", to="match_ledger")
start_action(run_key="sess_8f21", node_key="normalize_currency")
complete_action(run_key="sess_8f21", node_key="normalize_currency", output_summary="612 invoices converted to USD")

start_action(run_key="sess_8f21", node_key="match_ledger")
complete_action(run_key="sess_8f21", node_key="match_ledger", output_summary="3 mismatches",
                manual_minutes=25)
check_instructions(run_key="sess_8f21")

start_action(run_key="sess_8f21", node_key="flag_mismatches")
complete_action(run_key="sess_8f21", node_key="flag_mismatches", output_summary="3 flagged for review")

# Only 3 mismatches, all minor - the email is not worth sending. Say so rather
# than leaving it looking pending.
skip_action(run_key="sess_8f21", node_key="email_summary", reason="only 3 minor mismatches, not worth an email")

finish_run(run_key="sess_8f21", status="succeeded")
```

Note `run_key`: something stable you already have, like your session or thread
id. Reuse it in every call. Calling `start_run` twice with the same key resumes
the same run rather than starting a second one — which is what you want after
losing context.

## Every path, in one table

| What is happening | What to call |
|---|---|
| Starting a step | `start_action` |
| Working on it | `report_progress` |
| It worked | `complete_action` |
| It replaced work a person would have done by hand | same call, with `manual_minutes` |
| It broke | `fail_action` (reason required) |
| Retrying it after a failure | `start_action` again, same node_key |
| Waiting on a person or a decision | `block_action` reason=`user_decision` |
| Waiting on data that does not exist yet | `block_action` reason=`missing_data` |
| An external service is down | `block_action` reason=`provider_outage` |
| The block cleared | `start_action` again, same node_key |
| You started it and are abandoning it | `cancel_action` |
| You never started it and never will | `skip_action` |
| You found work nobody planned | `add_action` (+ `after` or `add_dependency`) |
| A step needs a second predecessor | `add_dependency` |
| You produced a file or link | `attach_artifact` |
| You forgot which keys you used | `get_graph` |
| Someone may have asked you to stop | `check_instructions` |
| You acted on what they asked | `resolve_instruction` |
| Everything is done | `finish_run` status=`succeeded`/`failed`/`cancelled` |

## Ending the run

`finish_run` takes `succeeded`, `failed` or `cancelled`. Before you call it,
resolve every step that is still open: `skip_action` anything you will never
reach now, `cancel_action` anything you had started and are dropping. A finished
run with steps still sitting at not_started or in_progress reads as an agent that
died mid-task.

Always call it, even when things went badly — especially then. **A run nobody
finishes is indistinguishable from an agent that crashed**, and that is the one
outcome the person watching cannot interpret.

If you genuinely cannot continue and cannot clean up, still call `finish_run`
with `status="failed"` and say why in `message`. A messy finished run beats a
tidy-looking abandoned one.
