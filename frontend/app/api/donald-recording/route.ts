import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

export async function GET() {
  const recording = await readFile(join(process.cwd(), 'lib', 'donald', 'events.recorded.jsonl'), 'utf8')
  return new Response(recording, {
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/x-ndjson; charset=utf-8',
    },
  })
}

type InstructionBody = {
  run_uuid?: unknown
  node_key?: unknown
  instruction?: unknown
  option_id?: unknown
  current_sequence?: unknown
}

export async function POST(request: Request) {
  const body = await request.json() as InstructionBody
  if (
    typeof body.run_uuid !== 'string' ||
    typeof body.node_key !== 'string' ||
    typeof body.instruction !== 'string' ||
    !body.instruction.trim() ||
    typeof body.current_sequence !== 'number'
  ) {
    return Response.json({ error: 'Invalid operator instruction' }, { status: 400 })
  }
  const sequence = Math.floor(body.current_sequence) + 1
  return Response.json({
    sequence,
    event_type: 'operator_instruction_queued',
    occurred_at: new Date().toISOString(),
    agent_label: null,
    node_key: body.node_key,
    idempotency_key: `operator-instruction-${body.run_uuid}-${sequence}`,
    payload: {
      instruction_id: `instruction-${sequence}`,
      instruction: body.instruction.trim(),
      option_id: typeof body.option_id === 'string' ? body.option_id : null,
    },
  })
}
