# Donald — project context

> **NextWave Hackathon 2026 · CDMX · Challenge 3: The Interface That Builds Itself**

---

## The boundary

```
NAUTA     executes. Sends the email, books the truck, disputes the invoice.
WE        decide what Jorge sees, and give him STOP and STEER.
JORGE     understands in 90 seconds and decides.
```

Nauta says it on its own website:

> *“Agents that do not send an alert and wait. **They act.**”*

Exactly — and that is the problem we solve:

| | |
|---|---|
| An agent that only **alerts** | The person reads, decides and acts. The person remains in control. |
| An agent that **acts** | Things happen without them. *How do I trust something that has already acted?* |

**The pitch line:**

> An agent that only alerts can be audited by reading the alert.
> **An agent that acts needs a window — and a brake.**

The schema itself proves that this is the product: `intervention_type: stop | steer`.
Those two verbs are everything.

---

## The operator

**Jorge, 52, operations director at Muebles del Sur.** He imports furniture from Vietnam. He has
done this for 20 years and is not technical.

He pays for Nauta. Nauta's agents work 24/7 and **act**. Jorge sees none of that work: he receives
a WhatsApp message saying something happened and still does not understand what the agent did or
why.

> *“I do not want a wall of text. I want to understand what was done.”*

**Metric:** time from detection to a confident decision. Today: hours, or never. With Donald:
**90 seconds.**

---

## How it opens to any use case — the jury's question

*“Aren't these predefined screens?”*

**No. The agent does not build animations; it builds structure. Animation is a property of that
structure.**

Only **six things** can happen in a graph:

| Structural event | Animation | Written |
|---|---|---|
| A node appears | enters gray, staggered by 80 ms | once |
| Its status changes | pulses; its incoming edge draws itself | once |
| It produces an artifact | the document flies into the node | once |
| It opens for a decision | **the node expands** into a panel | once |
| An edge is drawn | animated `stroke-dashoffset` | once |
| **The plan changes** | **the graph rewires itself live** | once |

Every use case in the world reduces to those six: a delayed shipment, an incorrect invoice, an
unresponsive supplier, a price outside the contract. The **content** changes; the **structural
events** do not.

> **HTML has about 110 tags and can render any page that exists.
> Tags are finite. Trees are infinite.**

Six finite animations. Infinite structure.

---

## The use-case families — Nauta's own

Each named Nauta agent represents a family:

| Agent | Use case | Nauta data point |
|---|---|---|
| **Nina** · Shipment Watch | delay, transshipment, ETA | ← ours |
| **Theo** · Freight Anomaly | freight overcharge | 39% of invoices contain errors |
| **Lauren** · Supplier Reliability | supplier does not confirm | |
| **Vera** · Price Drift | price outside contract | |
| **Alec** · Contract Compliance | violated term | |
| **Marcus** · Inventory Watch | stockout risk | 7.4% of sales lost |

**The pitch move:** show Nina's shipment case, then ask the same real agent to investigate the
L'Oréal invoice — another domain, different records and a plan the operator did not preselect —
**and let it render itself with no new frontend code.** Same reporting protocol, different graph.

---

# The agent skills

Plain text. **Not code.** `donald-flow` teaches any agent how to report honestly; `nauta-operations`
gives the demo agent a small, consistent world of suppliers, POs, invoices, messages, documents
and shipments. The operator supplies the request in natural language, and the agent decides the
plan at runtime.

## Prompt

```
You are Nina, Nauta's operations agent working for Jorge.

You act: inspect the records, reconcile them, calculate the impact and take the next step.
Report every step through Donald while it happens. Do not batch the run at the end.

Jorge is 52, runs operations for an importer and is not technical.
Make the work visible as a graph, with short evidence-backed updates.

For each step decide:
  · does this remain a compact routine check, or need more screen space?
  · does it require STOP and a decision from Jorge?
  · what evidence supports it?
  · how do I explain it without jargon?

INTERVENTION RULE:
  Ask before an action that is irreversible or costs money.
  Otherwise keep working and simply report it.

ATTENTION RULE:
  Anything that costs no money and blocks nothing stays compact.
  The more serious it is, the more screen space it deserves.
```

**That second rule is what makes the LLM essential:** it decides **structure and salience**, not
just words. It is why a routine status request and an invoice dispute look radically different
through the same code.

## Tools

| Tool | What it does | Event it emits |
|---|---|---|
| `declare_plan(nodes)` | draws the complete plan in gray before execution | `plan_declared` |
| `update_node(key, status, ui_spec)` | advances a node and renders its card | `node_status_changed` |
| `attach_artifact(key, artifact)` | attaches the email or document | `artifact_added` |
| `request_intervention(key, type, prompt, options)` | requests **stop** or **steer** | `intervention_requested` |
| `replan(remove, add, edges)` | **rewires the graph** | `node_removed` + `node_added` + `edge_*` |
| `finish_run(summary)` | closes and collapses the run | `run_finished` |

Six structural tools. Each maps to an `agent_event_type` in the schema. The deployed MCP
reporting surface provides the lower-level run and action calls described in `donald-flow`.

---

# The `ui_spec` — seven primitives with `children`

They belong in `agent_event.payload` (JSON). **Composable: the system builds trees; it does not
pick from hard-coded cards.**

```
LAYOUT      row · column · group        ← carry children
CONTENT     headline · metric · evidence · choice
```

```json
{"type":"column","children":[
  {"type":"headline","severity":"high","text":"Unplanned transshipment in Singapore"},
  {"type":"row","children":[
    {"type":"metric","label":"Demurrage","value":3780,"unit":"USD","delta":"+7 billable days"},
    {"type":"metric","label":"ETA","value":"14-SEP","delta":"+9 days"}
  ]},
  {"type":"evidence","src":"MSG-3312","quote":"Cargo rolled to MSC LIVORNO via Singapore"}
]}
```

**If the model emits anything outside the enum, the runner degrades it to plain text and keeps
going.** A malformed payload can **never** leave the screen blank.

---

# The demo

```
1. plan_declared     Nina proposes the initial steps in gray. “This is what I intend to do.”
2. Nodes light up one at a time as the real agent reads the request and records.
3. DETECT            unplanned transshipment
4. IMPACT            $3,780 · invalidated BL · the client misses ITS customer commitment
5. ⚡ Nauta is about to notify the client.
   The agent evaluates: irreversible + costs money → STOP
   The node OPENS into a decision panel with the draft and evidence.
6. Jorge chooses “find an alternative first” → STEER
7. ⚡ REPLAN: the notification step closes, new recovery work appears,
   and the edges rewire. THE GRAPH REDRAWS ITSELF.
```

**Step 7 is the entire pitch.** Nobody programmed that graph. It emerged from Jorge's decision.

Then type a different request — reconcile `INV-2088` against `PO-1048` — and the same agent
creates a different graph, follows `AMD-1048-01`, and proves the $840 mismatch is our error.

---

# Details visible on the projector

- **Delta by `sequence`.** `GET /agent_events?run_uuid=X&sequence_gt=42`. Without this, each poll
  replaces the state, React reconciles the entire list, **CSS animations restart every second**
  and the scroll jumps.
- **Natural timing.** A real agent chooses steps from free-form input, calls tools as work happens
  and may replan when evidence changes. It does not emit a prerecorded metronome.
- **Always something in motion.** Three seconds without motion looks like a hang, so the active
  node pulses even when no new event arrives.
- **Numbers count upward.** `$0 → $3,780` over 800 ms lands ten times harder than simply appearing.
- **Never buttons named “Run A” and “Run B.”** Show real requests and real operation names.
- **Only one active node at a time.** The eye must always know where to go.

---

# Pitch-ready visual direction

The event-driven frontend on `main` remains the product foundation. The static prototype from
`feat/donald-ui-v2` is reference material only; do not port its page, inspector, controls, graph,
or benchmark copy.

## The robot tells the story

- Donald is the visual protagonist, not a decoration inside a white card.
- Use Mau's robot asset and the idea of a state-aware companion, adapted to live runtime events.
- A single robot travels along graph edges in 600–900 ms. It must visibly move between positions;
  a glow or instant relocation does not count as movement.
- Give the robot purposeful state animation: inspect while working, stop and point at what is
  missing, receive new evidence, continue, and acknowledge completion once.
- Keep speech to one short sentence at meaningful transitions. The animation carries the story;
  text explains only what the motion cannot.
- Respect `prefers-reduced-motion` with an equivalent non-traveling state transition.

## The graph is a stage, not a wall of boxes

- Do not make every action an identical white rectangle. Use shape, depth, color, and scale to
  distinguish routine work, active work, waiting, decisions, money impact, and outcomes.
- Activity pulses and orbiting indicators should be larger and legible on a projector, while still
  directing attention to exactly one active step.
- Structural animations remain event-driven: evidence enters, the robot reacts, edges activate,
  and the graph changes only when runtime state changes.
- Waiting is amber and calm; failure is red and unmistakably different.

## Pitch copy and money

- All user-visible product and demo copy is English.
- Prefer plain outcomes over logistics or runtime jargon. A first-time viewer must understand what
  happened, why it matters, and what happens next within five seconds.
- Show economic impact only when the event payload supports it. Lead with one clear operation-level
  number and its consequence; move sources, calculations, and benchmarks behind `View details`.
- For the blocked-data demo, the core promise is: Donald does not guess when information is
  missing. It pauses safely, explains what it needs, and resumes from the same step when it arrives.
