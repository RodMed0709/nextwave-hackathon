# PROBLEM.md

**Challenge 3 — The Interface That Builds Itself** · NextWave Hackathon 2026, CDMX

---

## The thesis

> **The agent does not tell you what it did. It shows you while it does it.**
> The generated interface is not a nice feature. **It is the explanation.**

---

## The operator

**Jorge, 52. Operations director at Muebles del Sur**, an importer moving furniture from Vietnam
to Mexico. He has done this for 20 years. He is not technical, and he should not have to be.

**His day:**

- He arrives at 8:00. Sixty emails are waiting; three matter, and he does not know which three.
- He pays for Nauta. Its agent works all day: reading email, extracting data, reconciling records,
  watching deadlines, predicting delays, detecting exceptions, calculating impact, deciding and
  acting.
- **Jorge sees none of that.** He gets a summary, or an email, or nothing.
- When something breaks, he finds out late — or worse, **his client calls him first**.
- When he must decide, he calls someone to explain the situation. That call takes 30 minutes and
  happens three or four times a week.

**Jorge's exact point:**

> *“I do not want a wall of text. I want to understand what was done.”*

---

## The painful moment

**A shipment goes wrong, and a decision must be made today.**

What happens now:

1. Nauta's agent detects the issue at 09:14 and acts.
2. Jorge finds out at 14:00, the next day, or when his client complains.
3. Someone must spend 30 minutes explaining what happened.
4. He decides with incomplete information, or postpones the decision.

**The cost:** hours pass between detection and a confident decision. During that gap, demurrage
accumulates, response windows close, and the end customer learns about the problem before Jorge.

In the case we demonstrate: **$3,780 USD** and a customer commitment missed by four days.

---

## The metric

| | Today | With Donald |
|---|---|---|
| Detection → confident decision | hours (or never) | **90 seconds** |
| Calls to have the situation explained | 3–4 per week | 0 |
| Things the agent did that Jorge never saw | almost everything | nothing |

---

## The boundary with Nauta

**Nauta already performs the complete 12-step flow**, from INGEST to ACT. We do not compete with
that.

```
        NAUTA  ──  runs all 12 steps, autonomously, inside
              │
              │  reports what it did and why
              ▼
        DONALD  ──  makes the work visible and steerable
              │
              ▼
        JORGE  ──  understands and intervenes
```

> **Nauta decides what to do with the shipment.
> Donald decides what Jorge sees and when he needs to step in.**

Those are two different decisions. Nauta's is operational. Donald's is interactional.

For this prototype, the provider is represented by a **real general-purpose agent reading a Nauta
skill file**. It receives whatever the operator types, chooses its own plan and reports each step
to Donald over MCP. Replacing that demo agent with Nauta changes the provider, not the supervision
contract or the interface.

---

## What our system does

**It translates machine work for a person, and builds the screen that makes the work legible.**

| It decides | Example |
|---|---|
| Does this deserve Jorge's attention? | A routine check: no. An irreversible action: yes. |
| What matters in everything that happened? | Of three warnings, surface the customer commitment. |
| How do I explain it to a 52-year-old operator? | Not *“eta_slip 9d”* but *“it arrives four days after the date you promised your customer.”* |
| What evidence should be shown? | The MSC email and the client email, highlighted. |
| What should Jorge decide, and with which options? | The alternatives that emerged from the agent's plan. |
| What happens after his answer? | Rebuild the graph around the consequence. |

---

## Why this needs AI

**Because you cannot pre-program the screen for every situation.**

The situations are unlimited: an unplanned transshipment, an invalidated document, an
unresponsive supplier, a missing PO amendment, or a combination nobody has seen before. Today,
when an agent encounters an unusual case, **the screen does not exist** — because nobody built it.

If removing the LLM leaves the demo unchanged, the product is not AI-native, and the jury will
see it. **The proof is in two requests:** same code, same reporting contract, different evidence
and work → a different interface. Nobody programmed the second screen.

---

## Anti-scope — what we will NOT solve

- **We are not building Nauta's operational pipeline.** A real agent reads a compact domain skill
  for the demo; Donald only supervises what that agent reports.
- **This is not a configurable dashboard.** No filters, no saved views.
- **There is no multi-user system, login or mobile app.** One run, one screen.
- **We do not optimize routes or costs.** That belongs to Nauta.
- **This is not a question-and-answer chatbot.** If the person only asks and receives text, we
  have failed our own thesis.
- **We persist nothing that does not appear in the demo.**

---

## The moment we must win

The entire pitch turns on one instant:

> Give the same agent two real requests. In the first, it resolves the work alone and does not
> interrupt. In the second — **same code, same reporting contract, different operational
> evidence** — the agent stops and **a decision panel appears that did not exist in the first
> run**.

Everything else exists to reach that moment and carry the audience through it.
