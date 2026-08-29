# Card Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the event-driven workflow card itself the complete operator interface, including reflow, evidence, intervention controls, and instruction delivery.

**Architecture:** Keep `RunState` and its event log as the only runtime truth. Pure presentation helpers derive request copy, metrics, replan context, instruction lifecycle, and variable node dimensions; React Flow receives those derived dimensions so expanded and removed cards participate in collision-free layout. POST responses must be Donald events before they can change visible state.

**Tech Stack:** Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4 CSS, React Flow 12, Node test runner.

**Spec:** User task “simplify the interface — the card is the interface,” supplied in the 2026-08-29 task directive.

## Global Constraints

- No new dependencies.
- Everything user-visible, including fallbacks, is English.
- Respect `prefers-reduced-motion`.
- Do not invent state or controls outside the event payload.
- Keep `types.ts` and `reduce.ts` event semantics; additive display fields are permitted.
- Run tests, `tsc --noEmit`, production build, HTTP smoke test, copy greps, and browser checks before completion.

---

### Task 1: Collision-free variable-size graph layout

**Files:**
- Modify: `lib/donald/layout.ts`
- Test: `tests/donald/layout.test.ts`

**Interfaces:**
- Consumes: `RunNode`, `RunEdge`, and optional `Record<string, NodeSize>`.
- Produces: `layoutGraph(nodes, edges, previous, sizes)` and `getLayoutBounds(positions, sizes)`.

- [ ] Write tests proving expanded cards and retained removed cards keep a minimum gap and bounds use actual dimensions.
- [ ] Run `npx pnpm@10 test` and verify the new assertions fail because layout uses fixed `NODE_HEIGHT`.
- [ ] Implement size-aware column and row packing with deterministic ordering.
- [ ] Run `npx pnpm@10 test` and verify all layout tests pass.

### Task 2: Pure event-derived presentation and write contracts

**Files:**
- Modify: `lib/donald/presentation.ts`
- Modify: `lib/donald/source.ts`
- Modify: `lib/donald/types.ts`
- Modify: `lib/donald/reduce.ts`
- Modify: `app/api/donald-recording/route.ts`
- Test: `tests/donald/presentation.test.ts`
- Test: `tests/donald/source.test.ts`
- Test: `tests/donald/reduce.test.ts`

**Interfaces:**
- Consumes: run events, intervention option payload fields, `?run=<key>`, operator instruction POST bodies.
- Produces: request title, metric formatting, replan banner, instruction lifecycle, `postOperatorInstruction()`, and a local POST event response.

- [ ] Write failing tests for request fallback, ranked option metadata, metric priority, replan derivation, lifecycle timestamps, omitted `run_uuid` for latest run, and distinct POST payloads.
- [ ] Run focused tests and confirm failures identify the missing fields/helpers.
- [ ] Add only display fields to state/types and implement pure derivation plus the write boundary.
- [ ] Run the complete unit suite and confirm it passes.

### Task 3: Card-owned interaction and full viewport

**Files:**
- Create: `components/donald/run-viewer.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `components/donald/runtime-edge.tsx`

**Interfaces:**
- Consumes: server-provided optional run key and all Task 2 presentation data.
- Produces: one expanded card at a time, click-away collapse, inline evidence/options/instruction box, active/blocked/proposed/removed treatments, event strip, Reset, and full-window graph.

- [ ] Move URL parsing to the server page and pass the optional key to the client viewer.
- [ ] Replace the dashboard/inspector/control UI with inline expanded-card content and remove capability sniffing.
- [ ] Feed expanded dimensions into Task 1 layout and fit after every size or structural change.
- [ ] Make CSS transitions event-triggered, with no component-owned animation timeline or timeout.
- [ ] Run typecheck and unit tests, fixing strict errors without weakening types.

### Task 4: Replan and runtime motion

**Files:**
- Modify: `lib/donald/presentation.ts`
- Modify: `components/donald/run-viewer.tsx`
- Modify: `components/donald/runtime-edge.tsx`
- Modify: `app/globals.css`
- Test: `tests/donald/presentation.test.ts`

**Interfaces:**
- Consumes: structural events, graph revision events, active-node status, reduced-motion preference.
- Produces: `Recalculating…`, `REPLAN · reason · evidence`, staggered node/edge entry, retained removed decisions, gliding positions, and directional active-edge dashes.

- [ ] Add failing tests for graph-revision cause and structural batch presentation.
- [ ] Implement event-derived replan display and CSS-only movement keyed by event state.
- [ ] Confirm no timer controls the graph timeline and run the full suite.

### Task 5: Verification and atomic commit

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: completed working tree.
- Produces: verified branch commit and real command output.

- [ ] Run `npx pnpm@10 test`, `npx tsc --noEmit`, and `npx pnpm@10 build`.
- [ ] Serve the app, verify HTTP 200, and inspect 1920×1080 plus 4:3 in a browser.
- [ ] Verify expanded, active, blocked, proposed, removed, replan, and event-strip states against the recording.
- [ ] Run forbidden-copy and Spanish greps and report exact output.
- [ ] Review `git diff`, preserve unrelated files, and create atomic conventional commits without trailers.
