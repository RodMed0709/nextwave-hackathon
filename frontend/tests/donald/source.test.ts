import assert from 'node:assert/strict'
import test from 'node:test'
import { apiSource, parseEventStream, postOperatorInstruction, recordedSource } from '../../lib/donald/source'
import type { DonaldEvent } from '../../lib/donald/types'

function event(sequence: number, milliseconds: number): DonaldEvent {
  return {
    sequence,
    event_type: 'node_updated',
    occurred_at: new Date(Date.UTC(2026, 7, 29, 11, 20, 0, milliseconds)).toISOString(),
    agent_label: 'Nina',
    node_key: 'receive-update',
    idempotency_key: `event-${sequence}`,
    payload: { progress_percent: sequence * 10 },
  }
}

test('parseEventStream validates each JSONL event', () => {
  const parsed = parseEventStream(`${JSON.stringify(event(1, 0))}\n${JSON.stringify(event(2, 500))}\n`)
  assert.deepEqual(parsed.map((item) => item.sequence), [1, 2])
  assert.throws(() => parseEventStream('{"sequence":1}\n'), /Invalid Donald event/)
})

test('recordedSource honors event timing and supports an immediate manual step', async () => {
  const waits: number[] = []
  const fetchRecording: typeof fetch = async () => new Response([
    JSON.stringify(event(1, 0)),
    JSON.stringify(event(2, 500)),
    JSON.stringify(event(3, 1500)),
  ].join('\n'))
  const source = recordedSource({
    fetch: fetchRecording,
    wait: async (milliseconds) => { waits.push(milliseconds) },
  })

  assert.equal((await source.next()).value?.sequence, 1)
  assert.equal((await source.next()).value?.sequence, 2)
  assert.equal((await source.next({ immediate: true })).value?.sequence, 3)
  assert.deepEqual(waits, [500])
})

test('apiSource polls sequence_gt and yields server events in sequence order', async () => {
  const urls: string[] = []
  let request = 0
  const fetchApi: typeof fetch = async (input) => {
    urls.push(String(input))
    request += 1
    return new Response(JSON.stringify(request === 1 ? { events: [event(2, 500), event(1, 0)] } : { events: [event(3, 1000)] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  const source = apiSource('https://donald.example/api/', 'run 3482', {
    fetch: fetchApi,
    wait: async () => undefined,
  })

  assert.equal((await source.next()).value?.sequence, 1)
  assert.equal((await source.next()).value?.sequence, 2)
  assert.equal((await source.next()).value?.sequence, 3)
  assert.match(urls[0], /agent_events\?run_uuid=run\+3482&sequence_gt=0$/)
  assert.match(urls[1], /sequence_gt=2$/)
})

test('apiSource omits run_uuid when the latest run is requested', async () => {
  const urls: string[] = []
  const source = apiSource('https://donald.example/api/', null, {
    fetch: async (input) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ events: [event(1, 0)] }))
    },
  })

  await source.next()
  assert.doesNotMatch(urls[0], /run_uuid/)
  assert.match(urls[0], /sequence_gt=0$/)
})

test('postOperatorInstruction sends a distinct option id and returns its event', async () => {
  let postedBody: unknown = null
  const queued = {
    ...event(58, 0),
    event_type: 'operator_instruction_queued',
    node_key: 'decide-response',
    payload: { instruction_id: 'instruction-58', option_id: 'secure-new-bl' },
  }
  const result = await postOperatorInstruction(
    'https://donald.example/api/',
    '3482',
    {
      nodeKey: 'decide-response',
      instruction: 'Prioritize the new Bill of Lading',
      optionId: 'secure-new-bl',
      currentSequence: 57,
    },
    {
      fetch: async (_input, init) => {
        postedBody = JSON.parse(String(init?.body)) as unknown
        return Response.json(queued)
      },
    },
  )

  assert.deepEqual(postedBody, {
    run_uuid: '3482',
    node_key: 'decide-response',
    instruction: 'Prioritize the new Bill of Lading',
    option_id: 'secure-new-bl',
    current_sequence: 57,
  })
  assert.deepEqual(result, queued)
})
