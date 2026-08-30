# Donald Robot Motion Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task, with a specification review and a code-quality review after every task.

**Goal:** Make one Mau-designed Donald robot travel through the real execution graph and explain document, email, waiting, resume, currency, and completion events in a customer-readable pitch surface.

**Architecture:** Keep `RunState` and the event log as runtime truth. Add optional semantic activity and currency cues to progress events through the existing `detail` extension path, derive a pure frontend motion model, and render one graph-space robot in a React Flow `ViewportPortal` plus one screen-space activity overlay. Business state is never delayed by presentation animation and no animation is selected from arbitrary copy.

**Tech Stack:** Go MCP server, Next.js 16 App Router, React 19, strict TypeScript, React Flow 12, CSS transforms/opacity, Node test runner. No new dependency.

**Spec:** `docs/superpowers/specs/2026-08-29-donald-robot-motion-design.md`

## Global constraints

- Work only in `C:\Users\medro\Documents\_PERSONAL_PROJECTS\donald-robot-motion` on `feat/donald-robot-motion`.
- Do not merge, push, or modify `main`.
- Do not import Mau's static page, capability map, benchmarks, or action-impact data.
- Import only `frontend/public/donald-pet/donald-default.webp` from Mau commit `91eb8ca`.
- Do not edit generated files under `backend/donald/entity/agent_event_payload/`.
- Do not infer activity or currency from node keys, labels, capability names, artifact names, or copy.
- Keep all customer-visible text in English.
- Respect `prefers-reduced-motion` and preserve the same final semantic state.
- Run the relevant failing test before production code for every behavior change.
- Use atomic conventional commits without trailers.

## Baseline already established

- `frontend`: `npx.cmd pnpm@10 test` → 31 tests passed, 0 failed.
- `backend/donald`: `go test ./...` → passed; `app/mcp` passed in 4.647 s.
- Frontend dependencies were installed with `npx.cmd pnpm@10 install --frozen-lockfile`; the lockfile did not change.

---

### Task 1: Preserve truthful blocked and resumed run state

**Owner:** frontend state worker  
**Files:**

- Modify: `frontend/lib/donald/types.ts`
- Modify: `frontend/lib/donald/reduce.ts`
- Modify: `frontend/components/donald/run-viewer.tsx`
- Test: `frontend/tests/donald/reduce.test.ts`
- Test: `frontend/tests/donald/presentation.test.ts`

**Contract:** A recoverable node block changes the visible run state to the matching blocked status; resuming the same node returns the run to `running`; only a real failure is red.

- [ ] Add failing reducer tests for `blocked_on_missing_data`, `blocked_on_provider_outage`, `blocked_on_user_decision`, and same-node resume.
- [ ] Add a failing presentation assertion that blocked run labels say `WAITING FOR DATA`, `WAITING FOR PROVIDER`, or `NEEDS INPUT`, never `FAILED`.
- [ ] Run `npx.cmd pnpm@10 test` and confirm the new tests fail because `RunStatus` omits blocked states and the reducer does not update run status.
- [ ] Extend `RunStatus` additively and update `applyEvent` only at `node_status_changed` / intervention boundaries.
- [ ] Keep the latest block explanation in the event log; do not duplicate it into component-owned state.
- [ ] Run `npx.cmd pnpm@10 test` and confirm the full frontend suite passes.
- [ ] Commit: `fix: preserve recoverable run blocks`

---

### Task 2: Transport semantic motion cues through MCP events

**Owner:** backend event-contract worker  
**Files:**

- Create: `backend/donald/app/mcp/motion_cues.go`
- Create: `backend/donald/app/mcp/motion_cues_test.go`
- Modify: `backend/donald/app/mcp/nodes.go`
- Modify: `backend/donald/app/mcp/bus.go`
- Modify: `backend/donald/app/mcp/events_query.go`
- Test: `backend/donald/app/mcp/server_test.go`

**Contract:** `report_progress` accepts optional `activity` and `metric` objects. They are validated, stored in the existing JSON `detail`, and lifted back into named SSE payload fields. Existing callers and stored events remain unchanged.

Target wire shapes:

```json
{
  "activity": {
    "kind": "document.read",
    "phase": "started",
    "object": { "kind": "document", "label": "Commercial invoice" },
    "copy": "Reading the commercial invoice"
  },
  "metric": {
    "kind": "currency",
    "value": 15765,
    "currency": "USD",
    "label": "Duties and fees"
  }
}
```

- [ ] Add failing unit tests for supported activity enums, required object labels, finite currency values, three-letter uppercase currency codes, unknown-kind rejection, and omission when no cue is provided.
- [ ] Add a failing round-trip test proving activity and metric survive detail encoding and delta lifting without changing numeric values.
- [ ] Run `go test ./app/mcp -run 'Test(Motion|ReportProgress)' -count=1` and confirm the tests fail for missing helpers/fields.
- [ ] Implement small Go wire structs and pure validation/encode/decode helpers in `motion_cues.go`.
- [ ] Add optional fields to `ReportProgressParams`; serialize them into `AgentEventPayload.Detail` without editing the generated payload entity.
- [ ] Add typed optional `Activity` and `Metric` fields to `deltaPayload`; lift them in `deltasAfter` from the existing detail JSON.
- [ ] Preserve edge/plan detail parsing and old clients exactly.
- [ ] Run `gofmt` on touched Go files.
- [ ] Run `go test ./app/mcp -count=1`, then `go test ./...`.
- [ ] Commit: `feat: add semantic motion cues to progress events`

---

### Task 3: Derive a deterministic robot motion model

**Owner:** frontend motion-model worker  
**Files:**

- Create: `frontend/lib/donald/motion.ts`
- Create: `frontend/tests/donald/motion.test.ts`
- Modify: `frontend/lib/donald/types.ts`
- Modify: `frontend/tsconfig.tests.json` only if the new pure module is not already included

**Contract:** Pure functions convert explicit events, nodes, edges, positions, and sizes into a robot target, truthful route, activity cue, metric cue, copy, and bounded presentation queue. No React or timers live in this module.

Core types:

```ts
type RobotActivityKind =
  | 'work.generic'
  | 'document.read'
  | 'message.send'
  | 'message.receive'
  | 'data.check'
  | 'calculate'
  | 'submit'

type RobotMotionCue = {
  key: string
  targetNodeKey: string | null
  previousNodeKey: string | null
  activity: RobotActivityKind
  phase: 'started' | 'progress' | 'completed'
  object: { kind: 'document' | 'email' | 'record'; label: string } | null
  copy: string | null
  metric: { kind: 'currency'; value: number; currency: string; label: string } | null
  tone: 'active' | 'waiting' | 'success' | 'failure'
}
```

- [ ] Write failing tests for first active-node placement, direct real-edge travel, deterministic join predecessor, same-node resume, missing-edge fade fallback, run completion, and parallel focus selecting the most recent sequence.
- [ ] Write failing parsing tests proving explicit `document.read`, `message.send`, and currency cues work while identical words inside a plain `agent_message` do nothing.
- [ ] Write failing dedupe/queue tests: repeated idempotency keys do not replay; one in-flight cue plus one pending cue is the maximum; a newer pending cue replaces stale presentation without delaying reducer state.
- [ ] Write failing geometry tests for right-center to left-center anchors using actual node sizes.
- [ ] Run `npx.cmd pnpm@10 test` and confirm failures identify the missing motion module.
- [ ] Implement strict unknown-safe parsers and deterministic derivation functions.
- [ ] Reuse `getVisiblyActiveNodeKey`; do not fork a second focus algorithm.
- [ ] Return a fade-at-target transition when a route is absent; never synthesize an edge.
- [ ] Run `npx.cmd pnpm@10 test`.
- [ ] Commit: `feat: derive robot motion from run events`

---

### Task 4: Render one Mau robot in graph space

**Owner:** frontend stage worker  
**Prerequisite:** Task 3 motion contracts are committed.  
**Files:**

- Import: `frontend/public/donald-pet/donald-default.webp` from commit `91eb8ca`
- Create: `frontend/components/donald/robot/donald-robot.tsx`
- Create: `frontend/components/donald/robot/robot-stage.tsx`
- Create: `frontend/components/donald/robot/activity-props.tsx`
- Modify: `frontend/components/donald/runtime-edge.tsx`
- Modify: `frontend/components/donald/run-viewer.tsx`
- Modify: `frontend/app/globals.css`
- Test: `frontend/tests/donald/motion.test.ts`

**Contract:** Exactly one 104–120 px robot renders in a React Flow `ViewportPortal`, stays attached to graph coordinates, follows the same smooth-step geometry as the visible edge, and does not cover card content.

- [ ] Add failing pure tests for the shared smooth-step path inputs and settled destination placement.
- [ ] Run the focused test and observe the expected failure.
- [ ] Import the binary asset with a scoped Git restore from Mau's commit; verify it is a 168×260 WebP with transparency and is not byte-expanded into source.
- [ ] Extract a shared `getRuntimeEdgePath` helper used by both `RuntimeEdge` and `RobotStage`.
- [ ] Implement `DonaldRobot` as a skin/pose component with accessible presentation semantics and no business logic.
- [ ] Implement `RobotStage` inside `ViewportPortal`; separate the travel transform wrapper from the activity/pose wrapper.
- [ ] Key one-shot travel by the cue idempotency key and settle at the target after animation end.
- [ ] For reduced motion, snap to the target with a short fade and no route traversal.
- [ ] Compose the stage once in `RunViewer`, outside the node map.
- [ ] Run `npx.cmd pnpm@10 test` and `npx.cmd tsc --noEmit`.
- [ ] Commit: `feat: add the graph-space Donald robot`

---

### Task 5: Add truthful document, email, waiting, money, and completion props

**Owner:** frontend activity worker  
**Prerequisite:** Tasks 2–4 are committed.  
**Files:**

- Create: `frontend/components/donald/robot/activity-overlay.tsx`
- Modify: `frontend/components/donald/robot/activity-props.tsx`
- Modify: `frontend/components/donald/robot/robot-stage.tsx`
- Modify: `frontend/lib/donald/motion.ts`
- Modify: `frontend/components/donald/run-viewer.tsx`
- Modify: `frontend/app/globals.css`
- Test: `frontend/tests/donald/motion.test.ts`

**Contract:** Activity props are generic and event-driven. The envelope leaves only on confirmed node success, currency counts only from a typed metric, and waiting/resume never imply repeated work.

- [ ] Add failing tests mapping each supported activity kind to a stable visual primitive and short fallback copy.
- [ ] Add failing tests that an outbound envelope remains prepared during progress and becomes `send` only when the same node succeeds.
- [ ] Add failing tests that a same-node resume returns `resume` without a travel route.
- [ ] Add failing tests that untyped `metrics`, currency-like keys, artifact names, and agent copy never create the currency overlay.
- [ ] Run `npx.cmd pnpm@10 test` and confirm the new assertions fail.
- [ ] Implement sober SVG/CSS primitives: document + one scan, prepared/outbound/inbound envelope, missing-document silhouette, calculation, submit portal, and final check.
- [ ] Render one screen-space `ActivityOverlay` with a headline, optional second line, and typed currency value.
- [ ] Keep copy at nine words when possible; use explicit event copy first and safe English fallbacks second.
- [ ] Implement a single 800–900 ms currency count for normal motion and the final value instantly for reduced motion.
- [ ] Ensure unknown cues degrade to `work.generic` with no empty stage.
- [ ] Run `npx.cmd pnpm@10 test`, `npx.cmd tsc --noEmit`, and `npx.cmd pnpm@10 build`.
- [ ] Commit: `feat: animate Donald activity props`

---

### Task 6: Make the pitch hierarchy projector-readable

**Owner:** frontend presentation worker  
**Files:**

- Modify: `frontend/lib/donald/motion.ts`
- Modify: `frontend/tests/donald/motion.test.ts`
- Modify: `frontend/components/donald/run-viewer.tsx`
- Modify: `frontend/app/globals.css`

**Contract:** The viewer emphasizes Donald, the current action, the missing input, and the next outcome. Recoverable waiting is amber; red is reserved for failure. Technical chrome stays available but does not dominate.

- [ ] Add failing pure tests for a focus window containing previous/current/next nodes and preserving all nodes before work starts.
- [ ] Run the focused tests and confirm the focus-window behavior is missing.
- [ ] Implement camera bounds from the focus window once work is active; avoid moving the camera opposite Donald during travel.
- [ ] Replace the full-screen `Recalculating…` takeover with a compact, plain-English run-update ribbon.
- [ ] Start the technical event stream collapsed; de-emphasize run key, revision, and raw event count.
- [ ] Style `blocked` / `needs-human` cards and edges in accessible amber; keep `.failed` red.
- [ ] Remove competing infinite card/edge glows when the robot or a prop is already moving; permit one calm waiting breath.
- [ ] Guarantee 18 px critical copy, 28 px scene headline, at least 88 px robot height, and at least 640 px stage height at 1366×768.
- [ ] Extend the reduced-motion block to every new robot, prop, overlay, count, and camera transition.
- [ ] Run `npx.cmd pnpm@10 test`, `npx.cmd tsc --noEmit`, and `npx.cmd pnpm@10 build`.
- [ ] Commit: `feat: focus the pitch on Donald`

---

### Task 7: Make Nauta Use Case 02 the polished local demo

**Owner:** scenario/fixture worker  
**Files:**

- Create: `frontend/lib/donald/events.blocked-data.jsonl`
- Preserve: `frontend/lib/donald/events.recorded.jsonl` as the existing replan regression fixture
- Modify: `frontend/app/api/donald-recording/route.ts`
- Modify: `frontend/lib/donald/source.ts`
- Modify: `frontend/tests/donald/source.test.ts`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/donald/run-viewer.tsx`
- Modify: `nauta-dummy/nauta_agent_blocked_on_data.md`
- Test: `frontend/tests/donald/reduce.test.ts`

**Contract:** Local default presentation can play a fresh, explicit Nauta 02 recording in roughly 60–90 seconds, while live mode remains live and the existing replan recording remains selectable for regression.

- [ ] Add failing source/route tests for a whitelisted `blocked-data` recording and safe rejection/fallback for unknown scenario names.
- [ ] Add a failing reducer assertion covering the full Nauta sequence: start clean, block on invoice, receive input, resume the same node, calculate typed currency, submit, finish.
- [ ] Run `npx.cmd pnpm@10 test` and confirm the fixture/selector tests fail.
- [ ] Author the Nauta recording with unique ordered sequences, idempotency keys, real graph edges, semantic activity payloads, an amber pause, same-node resume, typed USD metric, and successful finish.
- [ ] Keep the recorded timeline honest and separate from live mode; do not use UI timers to create business events.
- [ ] Add a small server-page `demo` selector, defaulting local recorded mode to `blocked-data` and allowing the prior recording explicitly.
- [ ] Rewrite Use Case 02 pacing to the approved 60–90 second pitch profile and include exact optional `activity` / `metric` fields for the upgraded MCP server.
- [ ] Retain a clearly labeled long regression pacing appendix rather than deleting it.
- [ ] Run `npx.cmd pnpm@10 test` and a forbidden-Spanish grep over customer-visible frontend files.
- [ ] Commit: `feat: add the Nauta blocked-data pitch demo`

---

### Task 8: End-to-end verification and polish

**Owner:** primary integrator  
**Files:** Verify all modified files; change only defects found by the checks.

- [ ] Read the relevant installed Next.js 16 guides under `frontend/node_modules/next/dist/docs/` before changing any App Router API or page behavior from Task 7.
- [ ] Run `npx.cmd pnpm@10 test`; require all tests pass.
- [ ] Run `npx.cmd tsc --noEmit`; require exit 0.
- [ ] Run `npx.cmd pnpm@10 build`; require exit 0.
- [ ] Run `go test ./...` in `backend/donald`; require exit 0.
- [ ] Run `git diff --check`; require no whitespace errors.
- [ ] Start the frontend locally and verify HTTP 200.
- [ ] Use the in-app browser at 1366×768 and inspect: plan, document read, real travel, confirmed email send, amber wait, inbound invoice, same-node resume, typed money, submit, done.
- [ ] Repeat with reduced motion and confirm identical information/final states without travel, scan, loops, or count-up.
- [ ] Verify one robot only during parallel-node data and confirm no invented connection when a route is missing.
- [ ] Check washed-out contrast and grayscale distinction between waiting and failure.
- [ ] Check no horizontal scrolling, clipped props, hidden critical copy, robot/card overlap, or camera fight.
- [ ] Grep customer-visible files for Spanish, `Recalculating`, hardcoded capability names, currency regex triggers, benchmarks, and accidental Nauta branching in generic components.
- [ ] Commit only verification-driven fixes with scoped `fix:` commits.

---

### Task 9: Adversarial reviews and hardening

**Owner:** primary integrator; two independent reviewers  
**Review A:** pitch/product adversary  
**Review B:** runtime/accessibility adversary

- [ ] Give each reviewer the approved spec, plan, complete branch diff, test output, and browser evidence; neither reviewer edits files.
- [ ] Pitch adversary must try to disprove: five-second comprehension, customer-readable copy, robot prominence, restrained character, waiting clarity, and evidence-backed business claims.
- [ ] Runtime adversary must try to disprove: event truth, dedupe, burst handling, same-node resume, route correctness, reduced motion, accessibility, old-event compatibility, and no generated-file edits.
- [ ] Classify findings as blocking, high, medium, or optional; do not implement optional redesigns outside the approved spec.
- [ ] Fix every blocking/high finding with a failing regression test first.
- [ ] Re-run the complete Task 8 gate after fixes.
- [ ] Ask both reviewers to re-check only their findings and confirm closure.
- [ ] Review `git log --oneline origin/main..HEAD`, `git status --short`, and `git diff --stat origin/main...HEAD`.
- [ ] Do not push or merge. Deliver the feature branch, exact commits, real verification output, remaining risks, and local demo URL to Rodrigo.

## Stop condition

Stop when all acceptance criteria in the approved design are demonstrated, both adversarial reviews have no unresolved blocking/high findings, the worktree is clean, and the feature remains only on `feat/donald-robot-motion`. Do not broaden the work into a dashboard rewrite, multi-robot system, capability catalog, benchmark system, or `main` integration.
