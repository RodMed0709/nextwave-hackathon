# The live run — rules and runbook

One of the three pitch slots can be a REAL agent working live, if and only if it earns the slot
in rehearsal. This document is the complete set of rules for making that safe.

## The one rule that decides everything

**Rehearse the live run twice, complete, before the pitch. Two clean passes → it takes slot 3
(replacing the recorded land-pickup). One failure → it stays recorded and the live run becomes
the Q&A encore.** Decide from evidence, not optimism, and decide BEFORE walking on stage.

## What "live" means here

```
operator sentence → agent (Claude / Codex / ChatGPT with the skills) → MCP → usedonald.com/runs/<key>
```

The agent is any MCP-capable runner. Donald never runs agents; it watches them. That is the
thesis — "the interface builds itself from natural language" — and it is also why this demo is
honest: the judge watches the same pipeline any customer would use.

## Pre-flight (do all of it the same morning)

1. Agent session open BEFORE going on stage, with BOTH skills loaded: `skill/donald-flow/SKILL.md`
   and `skill/nauta-operations/SKILL.md`, and the MCP connected:
   `{ "mcpServers": { "donald": { "type": "http", "url": "https://mcp.usedonald.com/v1/mcp" } } }`
2. Smoke run that morning: one tiny run (`start_run` → one action → `finish_run`). Confirm it
   appears at `usedonald.com/runs/<its-key>`. If the smoke fails, the live slot is OFF — no debate.
3. Fourth browser tab already open on the agreed run key (see below). The tab shows CONNECTING
   until the run starts — that is normal and even good theater.
4. `wait` tool present in the agent's tool list (pacing on). If it is missing, the run finishes
   in seconds and the demo is dead — check it in the smoke run.
5. Laptop on power, sleep disabled, `next start` + tunnel + both containers up (they auto-restart,
   but verify: `docker ps` shows donald-api and donald-mysql).

## The run key convention

`live-<event>-<n>` — e.g. `live-pitch-001`, `live-judge-001`. Agreed before the pitch, typed into
the fourth tab beforehand. Never improvised on stage. Keys are per-client and case-sensitive.

## The super prompt (paste as-is, fill the blanks)

```
You are Nina, Nauta's operations agent, working for Mueblerías Berríos.
Load and follow the donald-flow skill exactly: report every step to Donald AS IT HAPPENS,
never batch at the end. Use run_key "live-pitch-001". Show the watch_url first.

Use the wait tool to give every step its declared duration - a step that says 20s takes 20s,
with report_progress between waits. The duration is the intervention window.

Declare a plan of 5-7 steps maximum. Narrate findings with real identifiers from the
nauta-operations world. Before any irreversible or costly action, block on a decision with
2-3 priced options. Poll check_instructions every ~10s while blocked; honour whatever the
operator picks, then resolve_instruction and continue. Finish with finish_run and a money
figure in the summary.

The request: <THE JUDGE'S OR OPERATOR'S SENTENCE GOES HERE>
```

Reserve request, if the judge does not offer one:
"L'Oréal's invoice does not match our PO. Find out what happened and draft the right email."

## Stage choreography (the 90-second slot)

| t | Screen | Say |
|---|---|---|
| 0:00 | Agent window: paste the sentence | "This is the whole integration: one sentence." |
| 0:10 | Fourth tab: the plan lands in grey | "Nobody wrote this screen. The agent proposed it." |
| 0:30 | Steps light and narrate | Read one finding aloud, with its identifier. |
| 0:55 | The gate opens with priced options | Click one ON the projector — the judge sees the write path. |
| 1:20 | The agent resumes, finishes | "That instruction went back over the same protocol." |

If the agent is slower than this, talk over it — the amber wait IS the product. If it stalls
past ~30s with nothing moving, say "and while it works, let me show you the same flow recorded"
and switch to the land-pickup tab. No apology, no fiddling.

## Failure playbook

| Symptom | Do |
|---|---|
| Run never appears in the tab | Switch to recorded land-pickup, keep talking. Encore dead. |
| Agent skips the gate | Let it finish; the run is still a live graph — narrate that. |
| Agent finishes too fast (no wait tool) | Same switch. Verify pacing in the NEXT smoke run. |
| Tunnel dies mid-run | localhost:3000 mirrors everything — swap the tab, carry on. |

## What we do NOT do

- No agent-runner inside Donald, no textbox that spawns agents. The agent is external on purpose.
- No improvised run keys, no untested judges' hardware, no live run without the morning smoke.
- No specialized task agents (email readers, PDF parsers) before the pitch — that is the roadmap
  slide, not today's build. The skill already supports them without touching Donald.
