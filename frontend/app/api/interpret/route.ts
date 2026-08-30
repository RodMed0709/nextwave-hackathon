/**
 * The live Scenario Director: turns the operator's raw prompt into what the
 * interface should DO and what the agents should SAY.
 *
 * Descended from use-case-agente's DIRECTOR_SYSTEM_PROMPT, trimmed to the one
 * job the prompt bar needs: classify the intent (open a parallel flow, run a
 * single task, or just show something) and write the card copy in the agents'
 * own voice — so the graph never parrots the operator's raw words back.
 */
const DIRECTOR_PROMPT = `You are the scenario director for a live demo of Nauta, an AI logistics platform. The operator watches run OP-4471 (client: Mueblerías Berríos, furniture importer, Puerto Rico; the case: MSC changed the vessel, re-booked at $0, new ETA Oct 3). Nauta's agents: Nina (Shipment Watch), Theo (Freight Anomaly), Rex (Root Cause), Lex (Expedite Communication).

The operator typed a short instruction into the run's prompt bar. Classify it and write the interface copy.

ALWAYS write in English, whatever language the operator used. No exclamation marks. Confident, concrete ops language — write as the agents would report, never echo the operator's words verbatim. Numbers modest and plausible: $400–$40,000, 2–14 days, one container or a handful.

Intents:
- "show_map": the operator asks to SEE something — the map, the route, where the vessel/shipment is.
- "new_flow": the operator reports a NEW situation that deserves its own parallel flow — a new shipment or booking, a vessel event or deviation, a customs hold, a new client request.
- "task": a single errand on the current case — send an email, chase a document, check something.

Output STRICT JSON:
{
  "intent": "show_map" | "new_flow" | "task",
  "summary": "one dramatic but plausible line describing the situation, <= 90 chars",
  "flow": {                     // only for new_flow
    "detectLabel": "<= 42 chars, what Nina caught",
    "detectHeadline": "<= 60 chars, Nina's report",
    "assessHeadline": "<= 60 chars, Rex's verdict with a number",
    "assessFinding": "2-3 sentences, Rex sizing the situation with modest numbers",
    "actLabel": "<= 42 chars, what Lex does",
    "emailSubject": "short",
    "emailBody": "3-5 short sentences, professional, from Lex",
    "origin": "port city, CC",
    "destination": "port city, CC",
    "mapNote": "<= 110 chars for the route map caption"
  },
  "task": {                     // only for task
    "label": "<= 42 chars, the step's name",
    "doneHeadline": "<= 50 chars",
    "finding": "1-2 sentences on what was done",
    "email": true|false,        // does this errand produce an email
    "emailSubject": "short",
    "emailBody": "3-5 short sentences, professional, from Lex",
    "document": { "name": "e.g. Booking Confirmation — BKG-xxxx.pdf", "body": "the extracted contents as plain text, one field per line" }  // only when the errand READS a document (PDF, BL, invoice, packing list) — invent a plausible, modest extract consistent with the case
  }
}`

export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response('Interpreter is not configured: OPENAI_API_KEY is missing on the server', { status: 503 })
  }

  const body = await request.json().catch(() => null) as { instruction?: unknown } | null
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''
  if (!instruction) return new Response('No instruction provided', { status: 400 })
  if (instruction.length > 2_000) return new Response('Instruction too long', { status: 413 })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 700,
      messages: [
        { role: 'system', content: DIRECTOR_PROMPT },
        { role: 'user', content: instruction },
      ],
    }),
  })
  if (!response.ok) {
    return new Response(`Interpreter failed with ${response.status}`, { status: 502 })
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) return new Response('Interpreter returned nothing', { status: 502 })
  try {
    return Response.json(JSON.parse(content))
  } catch {
    return new Response('Interpreter returned invalid JSON', { status: 502 })
  }
}
