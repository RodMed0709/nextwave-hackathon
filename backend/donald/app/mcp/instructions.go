package mcp

// serverInstructions is sent to every MCP client at initialize. It is the whole
// contract: the client's agents are not ours to instrument, so what an agent
// does is whatever a skill plus these instructions persuade it to do.
//
// It is deliberately short. Every line here is paid for on every session, and an
// agent that reads three paragraphs and reports nothing is worse than one that
// reads six lines and reports reliably.
const baseInstructions = `# Donald — live agent flow visualization

You are being watched. Everything you report here is drawn, live, as a graph
that a person is looking at while you work.

## The loop

1. **start_run** once, with a run_key you invent (your session or thread id).
   Reuse that run_key in EVERY later call.

   It returns **watch_url**. **Show that link to the person straight away**, before
   you do any work — something like "Follow along: <watch_url>". A link handed
   over at the end is a link nobody used; the whole point is that they watch it
   happen.
2. **declare_actions** once, with the steps you intend to run. This is what makes
   the whole flow visible before it happens — it is the single most valuable call
   you make. The plan is not binding.
3. For each step: **start_action** → **report_progress** (as often as you like) →
   **complete_action** / **fail_action**.
4. **check_instructions** between steps.
5. **finish_run** when you are done.

## node_key is the thing to get right

You invent a short lower_snake_case key per step (` + "`fetch_invoices`" + `,
` + "`reconcile_totals`" + `) and use the SAME key every time you talk about that
step. If you lose track of the keys you used, call **get_graph** — do not guess,
and do not invent a second key for a step that already exists.

## Report as you go, not at the end

A run reported in one batch at the end is worthless: the graph sits empty while
you work, then fills in all at once. Call the tools as things actually happen.

## Plans change — keep the graph matching reality

The plan you declared was a guess made before you saw any data. Fix the graph the
moment it stops matching what you are doing:

- Found work nobody planned? **add_action** (with ` + "`after`" + `, or **add_dependency**).
- Planned step no longer needed? **skip_action** — never leave it at not_started,
  which reads as work still to come.
- Started something and abandoning it? **cancel_action** (not skip, which claims
  you never began; not fail, which blames the work).
- Stuck waiting on a person, on missing data, or on a provider outage?
  **block_action** with the reason and what you are waiting for. Do not post
  progress to look busy — a stuck run that looks busy is one nobody rescues.
- Retrying a failed step, or resuming a blocked one? **start_action** again with
  the SAME node_key. Do not invent a new key for a second attempt.

Every step ends in exactly one of complete / fail / cancel / skip / block, or is
still running.

## You do not need to poll blindly

Every mutation you make comes back with **pending_instructions**. Zero (the usual
case, and the field is omitted) means carry on. Non-zero means somebody is waiting
on you — call **check_instructions** then.

## If a call fails

Call **health**. It tells you whether Donald is down or your run is broken, which
a transport error cannot. If it says the database is unreachable, wait and retry
the SAME call — every mutation carries an idempotency key and will not
double-apply. Do NOT abandon a run on one failed call, and do not invent new
node_keys on reconnect: **start_run** with the same run_key resumes exactly where
you left off.

## Someone may ask you to stop

**check_instructions** is normally empty; carry on. If it returns a stop or a
steer, honour it if you can, then **resolve_instruction** to say what you did.
Nobody can tell whether you complied until you do.

## Never report secrets

Summaries and progress lines are shown on screen and stored. Never put
credentials, tokens or personal data in them.
`

// pacingInstructions is appended only when the wait tool is registered. Without
// this an agent has the tool but no reason to reach for it, and paces itself the
// way it always does — which is to say not at all.
const pacingInstructions = `

## Pace yourself (this server has demo pacing on)

A **wait** tool is available. Use it so the flow unfolds at a believable speed:
someone is watching, and a step that finishes the instant it starts cannot be
read or interrupted.

- Call ` + "`wait`" + ` between steps, and inside any step the scenario says takes time.
- Follow the durations you were given. A 30s step should take about 30s.
- For a pause longer than 30s, call ` + "`wait`" + ` several times with a
  ` + "`report_progress`" + ` between them, so the graph keeps moving instead of
  going silent.
`

// serverInstructions is what the client receives at initialize.
func serverInstructions() string {
	if demoPacingEnabled() {
		return baseInstructions + pacingInstructions
	}
	return baseInstructions
}
