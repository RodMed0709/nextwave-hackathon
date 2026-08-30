# Donald Robot Motion Stage — Design Specification

**Status:** Approved direction, pending written-spec review  
**Date:** 2026-08-29  
**Branch:** `feat/donald-robot-motion`  
**Primary demo:** Nauta Use Case 02 — blocked on missing data

## 1. Outcome

Donald should turn a live agent run into a story a customer can understand from a projector:

1. one robot travels through the real execution graph;
2. the object it is working with appears beside it;
3. short, plain-English copy explains the business action;
4. waiting, failure, resumption, and completion are visibly different; and
5. money is shown only when the run supplies a typed, auditable value.

The result must remain a real event-driven product surface, not a timeline scripted specifically for Nauta.

## 2. Product decision

Use a **single robot stage over the existing React Flow graph**.

- Donald represents the orchestration of the whole run, not an individual card.
- Donald moves only between nodes connected by the real graph.
- The current agent remains secondary context through `agent_label`.
- Activity props explain the work: document, email, record, calculation, or submission.
- Important copy and currency values render in screen space so graph zoom cannot make them unreadable.
- Mau's robot face and silhouette provide the character. Motion remains controlled and premium: no confetti, bounce loops, sad faces, or exaggerated squash.

Rejected alternatives:

- **One robot per card:** duplicates the protagonist and does not communicate travel.
- **A Nauta-specific cinematic timeline:** looks polished but invents pacing and cannot generalize to other agents.

## 3. Design principles

### 3.1 Causality over decoration

Every animation must answer one of these questions:

- Where is Donald going?
- What object entered the work?
- What is Donald doing to it?
- What object or result left the work?
- Why did the run stop, and what happens next?

Animations start from a new event sequence. Presentation timers may animate a transition, but they must never advance business state.

### 3.2 One visual sentence at a time

- One robot per run.
- At most one active prop beside the robot.
- At most one prominent message.
- At most one continuous loop, reserved for a truthful active or waiting state.
- Copy should normally stay under nine words; waiting explanations may use a short second line.

### 3.3 Friendly, not childish

- Preserve Mau's expressive robot asset.
- Use rolling or gliding travel because the robot has wheels.
- Allow a small directional tilt, capped at roughly six degrees.
- Avoid bouncing, wobbling, emoji, confetti, sound, and fake excitement.
- Amber means recoverable waiting. Red means a real failure only.

## 4. System architecture

```text
SSE event stream
      |
      v
existing run reducer ------> RunState
      |                         |
      |                         v
      +-----------------> MotionCueAdapter
                                |
                                v
                         RobotMotionState
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
       RobotStage                          ActivityOverlay
  React Flow graph space                  browser screen space
  robot + travel route                 copy + typed money result
```

### 4.1 `MotionCueAdapter`

The adapter derives presentation cues from:

- event sequence and idempotency key;
- node and edge state;
- the most recent visibly active node;
- explicit optional activity and metric metadata.

It must never inspect arbitrary copy, node names, capability labels, or keys with regular expressions to decide which animation to play.

### 4.2 `RobotStage`

`RobotStage` renders one overlay inside React Flow's `ViewportPortal` so the robot shares graph coordinates with nodes and edges.

- A travel route follows the real edge geometry.
- Travel and activity use nested elements so their CSS transforms do not conflict.
- The current layout positions are captured for the duration of a trip; a layout recalculation must not bend the route mid-animation.
- If no real route can be resolved, Donald fades at the target. The UI never invents an edge.
- A same-node resume changes posture and state without fake travel.

### 4.3 `ActivityOverlay`

Customer-facing copy, waiting explanations, and currency results live in a fixed screen-space overlay. This keeps critical information readable at 1366×768 and under projector scaling.

Raw artifacts and technical metadata remain behind an optional details surface.

## 5. Event contract

Existing structural events continue to drive plan, travel, waiting, resumption, and completion. Rich activity animations use optional, versionable metadata:

```ts
type ActivityCue = {
  kind:
    | "document.read"
    | "message.send"
    | "message.receive"
    | "data.check"
    | "calculate"
    | "submit";
  phase?: "started" | "progress" | "completed";
  object?: {
    kind: "document" | "email" | "record";
    label: string;
  };
  copy?: string;
};

type MetricCue = {
  kind: "currency";
  value: number;
  currency: string;
  label: string;
};
```

The fields may initially travel inside the existing update/artifact payload if that preserves compatibility. Older events remain valid:

- no activity cue: render `work.generic`;
- no typed metric: show no monetary animation;
- unknown activity kind: render a generic, non-empty fallback;
- repeated sequence or idempotency key: do not replay the cue.

An outbound email may form while work is in progress, but the envelope may leave only after the event confirms success. This prevents the UI from claiming an action happened before the runtime confirms it.

## 6. Motion vocabulary

| Runtime trigger | Presentation | Target duration |
| --- | --- | ---: |
| Plan declared | Route appears; Donald enters at the first focus | 480 ms |
| Different node becomes `in_progress` | Donald rolls along the resolved edge | 720 ms + 120 ms settle |
| `document.read` | Document appears and receives one scan pass | 900 ms |
| Successful document action | Scan resolves to a small check; document files away | 360 ms |
| Successful `message.send` | Envelope follows a short outbound arc | 640–680 ms |
| Recoverable missing-data block | Donald parks; document silhouette and amber state appear | 420 ms |
| Input artifact or `message.receive` | Envelope enters and reveals the object | 720 ms |
| Same blocked node returns to `in_progress` | Donald reactivates without travel | 320–420 ms |
| Typed currency metric completes | Final value counts once in screen space | 800–900 ms |
| `submit` | Document moves to a restrained destination portal | 620 ms |
| Run succeeds | Check draws once; Donald faces the result | 650 ms |

House easing: `cubic-bezier(.2,.72,.2,1)`, adjusted only where acceleration conveys a real send action.

No one-shot transition should exceed roughly 900 ms. A document scan may repeat only while the corresponding real action remains active. Waiting may use one slow amber breathing loop without implying progress.

## 7. Nauta Use Case 02 pitch storyboard

The pitch profile uses the same event order as the real scenario, with presentation-safe pacing of approximately 60–90 seconds. The longer regression scenario remains available separately.

1. **Plan:** “I'll check the shipment and prepare the filing.”
2. **Read shipment notice:** Donald travels; a document is scanned.
3. **Find purchase order:** a restrained confirmation appears.
4. **Read packing list:** scan resolves to “Packing list checked — 118 packages”.
5. **Find commercial invoice:** an empty document silhouette appears.
6. **Request missing invoice:** a confirmed outbound envelope leaves Donald.
7. **Wait:** stage turns amber; “Waiting for one document”. Second line: “Donald will continue automatically when it arrives.”
8. **Receive invoice:** an inbound envelope reveals the document.
9. **Resume:** the same node returns to active without repeated work or fake travel.
10. **Calculate:** a typed currency result appears once: “Duties and fees calculated”.
11. **Submit:** the prepared document moves into a destination portal.
12. **Finish:** “Customs entry submitted”, supported by “No values guessed” and “No work repeated” only when the event history proves those claims.

## 8. Visual hierarchy

- Donald is 104–120 px tall at normal demo zoom and never smaller than 88 px.
- Active props are 44–56 px.
- Critical copy is at least 18 px; scene headlines are at least 28 px.
- The camera prioritizes previous, current, and next nodes. The full eight-node graph remains context, not the permanently fitted reading surface.
- The robot anchor sits outside the card content area and does not cover titles, metrics, handles, or edges.
- Waiting and failure differ by color, icon, and shape, not color alone.
- The header and collapsed footer must leave at least 640 px of useful stage height at 1366×768.
- Developer details such as event count, run key, and revision do not dominate the pitch view.

## 9. Accessibility and performance

- `prefers-reduced-motion` replaces travel, scanning, counting, and loops with short fades and identical final states.
- Customer-facing text meets WCAG AA contrast.
- Test the waiting state in grayscale and under washed-out projector conditions.
- Locomotion and props animate with `transform` and `opacity` where possible.
- Target at least 30 fps on the intended demo hardware.
- Never move the camera in the opposite direction while Donald is traveling.
- Event bursts use a bounded presentation queue. Business events are never delayed or discarded by the reducer.

## 10. Expected implementation surface

The implementation plan may refine names, but ownership should remain separated:

- `frontend/public/donald-pet/donald-default.webp` — import only Mau's useful robot asset from commit `91eb8ca`.
- `frontend/components/donald/robot/donald-robot.tsx` — visual skin and pose.
- `frontend/components/donald/robot/robot-stage.tsx` — graph-space location and travel.
- `frontend/components/donald/robot/activity-props.tsx` — generic object primitives.
- `frontend/components/donald/robot/activity-overlay.tsx` — screen-space copy and metrics.
- `frontend/lib/donald/motion.ts` — pure cue and route derivation.
- `frontend/lib/donald/types.ts` — compatible activity and metric types.
- `frontend/components/donald/run-viewer.tsx` — stage composition and presentation hierarchy.
- `frontend/app/globals.css` — motion tokens, amber waiting state, and reduced-motion styles.
- Backend MCP/event files only where needed to transport optional semantic cues without breaking existing clients.

Do not import Mau's static page, capability map, hardcoded benchmark copy, or action-impact data.

## 11. Verification strategy

### Pure motion tests

- initial active node placement;
- travel only across a real edge;
- deterministic predecessor selection at joins;
- no travel when the same blocked node resumes;
- no invented route when an edge is missing;
- duplicate events do not replay activity;
- unknown activity kinds fall back safely;
- text alone never triggers document, email, or money animation;
- a currency cue survives event reduction and presentation unchanged.

### Component and integration tests

- one robot renders even with parallel active nodes;
- document, email, waiting, resume, money, and done states reach their correct final visuals;
- an envelope does not leave before confirmed success;
- waiting is amber and failure is red;
- reduced motion reaches the same semantic states;
- burst events preserve order without blocking the reducer.

### Browser acceptance

- run Use Case 02 from a clean run key;
- verify the robot travels between real connected nodes;
- pause at missing invoice and inspect the amber explanation;
- resume on the same node after the input artifact arrives;
- confirm no completed work is replayed;
- verify the currency value comes from the event payload;
- inspect at 1366×768, 100% Chrome zoom, and projector-like contrast;
- confirm there is no horizontal scroll, clipping, overlapping copy, or unreadable critical text.

## 12. Delivery slices

### Slice 1 — truthful locomotion

One robot, real route resolution, current/waiting/resume/done poses, amber waiting, reduced motion, and no semantic prop dependency.

### Slice 2 — semantic activity props

Optional event metadata, document read, confirmed email send/receive, generic fallback, and typed currency presentation.

### Slice 3 — pitch hardening

Nauta 02 pacing profile, projector layout, camera behavior, visual polish, browser verification, and adversarial product/engineering reviews.

Each slice must be demonstrable and independently testable. No slice may introduce Nauta-specific branching into generic runtime or presentation components.

## 13. Acceptance criteria

The feature is ready to show when:

1. a customer can identify what Donald is doing, what is missing, and what happens next within five seconds;
2. exactly one robot represents the run and follows real graph structure;
3. reading, sending, receiving, waiting, resuming, calculating, and completing have distinct but restrained presentations;
4. no customer-facing animation is inferred from arbitrary text;
5. waiting never looks like failure;
6. email and money claims appear only after structured evidence;
7. the demo begins from a fresh run and does not repeat completed work after resume;
8. reduced-motion users receive the same information;
9. relevant automated suites pass; and
10. both pitch and engineering adversarial reviews have no unresolved blocking findings.

## 14. Out of scope

- Multiple simultaneous robots.
- A hardcoded capability-to-animation map.
- A replacement for the existing event reducer or graph engine.
- Fake business-state timers or pre-recorded Nauta-only timelines.
- Hardcoded ROI benchmarks or monetary savings.
- Importing Mau's static prototype page.
- Modifying or merging into `main` as part of implementation.
