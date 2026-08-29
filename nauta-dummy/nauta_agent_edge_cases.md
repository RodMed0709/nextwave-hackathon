# Use case 07 — Edge cases

Short scenarios, each isolating one thing that breaks agent instrumentation in the wild.
Run any of them in 60–90 seconds. Use them to test, not to present — except **A**, which
is the best live demo moment in the whole set.

Base story for all of them: a routine arrival check on container **MSCU-4471820**, plan
`ingest_notice → identify_booking → extract_bl → reconcile_routing → act_confirm`.

---

## A · The operator stops a running agent

**run_key** `nauta-edge-stop-007a` · shows the stop button doing something real

Get to `reconcile_routing`, start it, and give it a **long** duration — `wait(30, ...)` twice with a progress line between,
so there is a full minute in which to press stop. While it runs, someone clicks **stop** in the UI.

```
check_instructions(run_key="nauta-edge-stop-007a")
→ [{id: "...", type: "stop", node_key: "reconcile_routing", message: "hold off, the booking is being amended"}]

cancel_action(node_key="reconcile_routing", reason="Operator asked to hold: the booking is being amended.")
skip_action(node_key="act_confirm", reason="Not confirming an arrival against a booking that is mid-amendment.")
resolve_instruction(id="...", outcome="applied", response="Stopped at reconcile_routing and confirmed nothing. Nothing was sent to the customer.")
finish_run(status="cancelled", message="Stopped by operator during routing reconciliation.")
```

**Why this is the moment.** A stop is only meaningful if there was time to press it. This
is the concrete payoff of giving steps honest durations: a graph of instant steps has a
decorative stop button. Note also that the agent is *advisory* — it stops at the next poll,
not mid-instruction — and saying that out loud is more honest than implying a kill switch.

---

## B · Provider outage, then recovery

**run_key** `nauta-edge-outage-007b` · exercises `provider_outage` and a successful retry

```
start_action(node_key="extract_bl")
report_progress(node_key="extract_bl", message="requesting BL from the carrier document API")
block_action(node_key="extract_bl", reason="provider_outage",
  message="MSC document API returning 503 for 4 minutes. Not our credentials — their status page confirms a partial outage.")

wait(30, "MSC document API still returning 503")

start_action(node_key="extract_bl")
complete_action(node_key="extract_bl", output_summary="BL MSCUXM2213 retrieved once the API recovered.")
```

Two things to check: the run goes blocked and comes back to in_progress on its own, and
the **retry actually applies**. A second `start_action` on the same node used to be
swallowed by the idempotency key, leaving the node stuck while the agent was told it had
succeeded.

Distinguishing `provider_outage` from `missing_data` matters operationally — one resolves
itself, the other needs a human to go and find something.

---

## C · The agent loses its own plan

**run_key** `nauta-edge-amnesia-007c` · the failure this whole design expects

Declare the plan, complete two steps, then **behave as if context was lost**: do not
recall the node_keys. Recover properly:

```
get_graph(run_key="nauta-edge-amnesia-007c")
→ ingest_notice: succeeded · identify_booking: succeeded · extract_bl: not_started · ...
start_action(node_key="extract_bl")
```

The wrong behaviour — inventing `extract_bill` or `extract-bl` and creating a duplicate
node — is the single most common way an LLM-reported graph goes wrong. Run this one to
confirm `get_graph` is enough to recover, and that it returns only keys, names and
statuses rather than refilling the context with everything already written.

---

## D · Duplicate and out-of-order reports

**run_key** `nauta-edge-dupes-007d` · idempotency under a flaky connection

Send the same call twice in a row, several times:

```
complete_action(node_key="identify_booking", output_summary="Booking BKG-99210")
complete_action(node_key="identify_booking", output_summary="Booking BKG-99210")   # duplicate
```

Expect: **one** node, **one** event, the same sequence returned both times. Then report a
step out of order — `complete_action` on a node never started — and confirm it back-fills
a start time rather than leaving a node that finished but never began.

Nothing here is user-visible when it works. It is visible immediately when it does not:
duplicated nodes, doubled events, a sequence with holes in it.

---

## E · The step that runs long

**run_key** `nauta-edge-slow-007e` · "it is taking a while" as a first-class signal

Give `reconcile_routing` an estimate of 20 seconds and then take **70** — chain
`wait(30)`, `wait(30)`, `wait(10)` with progress between them. Post progress
throughout, and past the estimate say so plainly:

```
report_progress(node_key="reconcile_routing",
  message="still reconciling — 68s against a 20s estimate; the carrier API is responding slowly")
```

A step running 3× its estimate is a legitimate reason for a human to intervene, and it is
information the graph can show without anything having failed. Worth watching once to check
a long-running node still streams rather than appearing frozen.

---

## F · The run that never ends

**run_key** `nauta-edge-abandoned-007f` · what a crashed agent looks like

Start the run, complete two steps, start a third — then **stop reporting entirely**. Never
call `finish_run`.

Leave it. Come back later and look: the run sits in_progress forever, one node stuck
mid-flight, `last_heartbeat_at` frozen. That is deliberately indistinguishable from an
agent still working, which is exactly why the skill insists on always calling `finish_run`.

Use this one to decide what the UI should do about it — a run whose heartbeat is older than
some threshold probably deserves to be shown as stale rather than live. Nothing in the
backend does that today.

**Schema reminder.** Pass `agent_label` on every declared step so the UI can lane it, and
use `depends_on: [...]` (not `after`) wherever a step waits on more than one predecessor.
See `nauta_agent_happy_path.md` for a full worked `declare_actions` call.

## Pacing — how to actually take the time

This server exposes a **`wait`** tool (demo pacing is on). Durations in this brief are not
decoration: use `wait` to spend them.

```
start_action(node_key="predict_arrival")
wait(10, "modelling berth window")
report_progress(node_key="predict_arrival", message="berth window 07-SEP 12:00-18:00", percent=40)
wait(10, "scoring gate-out")
report_progress(node_key="predict_arrival", message="scoring gate-out probability", percent=75)
wait(8, "finalising")
complete_action(node_key="predict_arrival", output_summary="Berthing 07-SEP 14:00, gate-out 09-SEP. Confidence 0.82.")
```

A single `wait` is capped at **30s** — for longer, chain several with a `report_progress`
between them so the graph keeps moving instead of going silent.

**Without this the demo does not work.** An LLM has no clock and will fire every tool call
in seconds; the run finishes before anyone can read it, and stop and steer have nothing to
act on. If `wait` is missing from your tool list, pacing is disabled on the server — say so
rather than pretending, and see the deploy README for how to switch it on.
