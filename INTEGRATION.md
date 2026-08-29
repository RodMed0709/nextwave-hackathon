# Wiring the backend to the frontend

Everything is deployed and everything works — separately. This is the list of what has to line up
so a live run draws on screen, and who owns each item.

**The rule that keeps this small: the frontend writes an adapter and absorbs every difference it
possibly can.** Names, formats, enums as integers, envelope shape — all of that is ours to
translate. The only things the backend has to change are the ones the frontend **cannot invent**,
because the data does not exist anywhere.

That leaves three items for the backend.

---

## Backend — the three things only you can do

### 1. `declare_actions` must emit one `node_added` per action, and one `edge_added` per `after`

Today it writes the nodes and edges into the database inside `apply`, and emits a single
`plan_declared` event carrying `"declared N planned actions"`.

The frontend builds the graph **from events**, so with no `node_added` there are no nodes. The
proposed plan — the grey cards that appear before any work happens — cannot be drawn at all.

This is the most valuable call in the whole protocol, and the one every skill file tells the agent
is the most valuable thing it says. Right now it produces nothing drawable.

Each `node_added` needs `node_key`, the action's `name`, `planned: true` and its `plan_order`.
Each `edge_added` needs an `edge_key`, `source_node_key` and `target_node_key`.

### 2. Every event needs `node_key`, not only `node_uuid`

`Delta` in `app/mcp/bus.go` carries `node_uuid`. The agent speaks in `node_key`, the frontend keys
its graph on `node_key`, and there is no lookup table on the client to resolve one to the other.

Adding `node_key` alongside the uuid is enough. Keep the uuid.

### 3. `intervention_requested` has to be emitted when a human creates one

`check_instructions` emits `intervention_delivered`, and `resolve_instruction` emits
`intervention_resolved`. Nothing emits `intervention_requested`.

That is the event the frontend uses to open the decision panel on the node. Without it, the
human-in-the-loop moment — the thing the whole product is for — cannot appear from live data.

---

## Also useful, but we can work around it

These make the screen better. If they are expensive, tell us and we will handle them on our side
or accept a poorer card.

- **Serialize enums as strings.** They currently come out as integers, because the generated enums
  have no `MarshalJSON`. We can map integers to names if you send us the mapping, but strings are
  less brittle for both of us.
- **Let the display fields reach the payload.** `complete_action(output_summary=…)` currently lands
  in `payload.message`. If a step's finding, its numbers and its evidence ids arrive in the payload,
  the card can show what the step *found* rather than what it was *called*. This is what makes the
  demo land: `$3,780`, `AMD-1048-01`, `MSG-3304` on screen instead of a filename.
- **`artifact_added` payload.** It sends `{artifact_uuid, message}`. The card renders the document
  itself when it receives `artifact_type`, `name`, `content_type` and `text_content`. The carrier
  email quoted verbatim under the step that read it is the strongest single moment in the product,
  and the data already exists on your side.

---

## Frontend — what we are doing, so you do not have to

- **An adapter layer.** Whatever shape your events arrive in, we translate. You should not have to
  reshape anything for our convenience.
- **`{items: […]}` vs a bare array** — ours to handle.
- **Enum integers** — ours, if you send the mapping.
- **The run key.** No longer hardcoded; read from `?run=<key>`, falling back to the most recent run.
- **The write path.** A typed instruction now `POST`s back so the operator can redirect a running
  agent. Point us at the right endpoint and we will match its contract exactly.

---

## How we will know it worked

In order, each one observable:

1. A real agent calls `start_run` and the header shows its request instead of a placeholder.
2. It calls `declare_actions` and the grey proposed cards appear before any work starts.
3. Cards light up and settle as it advances.
4. It calls `add_action` / `skip_action` and the graph rewires, revision climbing.
5. It blocks, and the decision panel opens **on the node**.
6. A human types an instruction, the agent picks it up on its next `check_instructions`, and the
   graph changes because of it.

Step 2 is the one that is impossible today, and everything visual downstream depends on it.

---

## One thing that is not code

The skill file and the scenario briefs describe **two different worlds** — Singapore vs Busan,
different Bill of Lading numbers, different amounts. Whichever we load, we should load only one. If
the agent sees both it will mix the numbers, and a jury that checks one figure against another
screen will find they disagree.
