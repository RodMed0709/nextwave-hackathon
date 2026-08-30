import assert from 'node:assert/strict'
import test from 'node:test'
import { liveSource, parseEventStream, postOperatorInstruction, recordedSource } from '../../lib/donald/source'
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

test('liveSource reads SSE frames, skips keepalives, and yields events in order', async () => {
  const body = [
    ': keepalive\n\n',
    'id: 1\nevent: run_started\ndata: {"sequence":1,"event_type":"run_started","occurred_at":"2026-08-29T11:20:00Z","idempotency_key":"a","payload":{}}\n\n',
    'id: 2\nevent: node_added\ndata: {"sequence":2,"event_type":"node_added","occurred_at":"2026-08-29T11:20:01Z","node_key":"ingest","agent_label":"Nina","idempotency_key":"b","payload":{"label":"Ingest"}}\n\n',
  ].join('')

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  const fetchStub = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch

  const source = liveSource('https://api.example.com', 'run-1', { fetch: fetchStub, wait: async () => {} })
  const first = await source.next()
  const second = await source.next()

  assert.equal(first.value?.sequence, 1)
  assert.equal(second.value?.sequence, 2)
  // Absent fields must be null, not undefined: the reducer's validator rejects undefined.
  assert.equal(first.value?.node_key, null)
  assert.equal(first.value?.agent_label, null)
  assert.equal(second.value?.node_key, 'ingest')
  assert.equal(second.value?.agent_label, 'Nina')
})

test('liveSource sanitizes typed subtask snapshots without collapsing absent and empty', async () => {
  const body = [
    'data: {"sequence":1,"event_type":"node_updated","occurred_at":"2026-08-29T11:20:00Z","node_key":"build","idempotency_key":"a","payload":{}}\n\n',
    'data: {"sequence":2,"event_type":"node_updated","occurred_at":"2026-08-29T11:20:01Z","node_key":"build","idempotency_key":"b","payload":{"subtasks":[]}}\n\n',
    'data: {"sequence":3,"event_type":"node_updated","occurred_at":"2026-08-29T11:20:02Z","node_key":"build","idempotency_key":"c","payload":{"subtasks":[{"key":"write-test","label":"Write the failing test","status":"running"},{"key":"implement","label":"Implement the change"},{"key":"implement","label":"Duplicate key","status":"done"},{"key":"verify","label":"Verify the result","status":"waiting"},null,{"key":"broken"}]}}\n\n',
  ].join('')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  const source = liveSource('https://api.example.com', 'run-1', {
    fetch: (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
    wait: async () => {},
  })

  const absent = (await source.next()).value
  const empty = (await source.next()).value
  const sanitized = (await source.next()).value

  assert.ok(absent && !Object.hasOwn(absent.payload, 'subtasks'))
  assert.deepEqual(empty?.payload.subtasks, [])
  assert.deepEqual(sanitized?.payload.subtasks, [
    { key: 'write-test', label: 'Write the failing test', status: 'running' },
    { key: 'implement', label: 'Implement the change', status: 'pending' },
    { key: 'verify', label: 'Verify the result', status: 'pending' },
  ])
})

test('liveSource resolves the newest run when no run key is given', async () => {
  const calls: string[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"sequence":1,"event_type":"run_started","occurred_at":"2026-08-29T11:20:00Z","idempotency_key":"a","payload":{}}\n\n',
      ))
      controller.close()
    },
  })
  const fetchStub = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/runs')) {
      return new Response(JSON.stringify({ runs: [{ run_key: 'newest-run' }] }), { status: 200 })
    }
    return new Response(stream, { status: 200 })
  }) as unknown as typeof fetch

  const source = liveSource('https://api.example.com/v1', null, { fetch: fetchStub, wait: async () => {} })
  const first = await source.next()

  assert.equal(first.value?.sequence, 1)
  assert.ok(calls[0].endsWith('/v1/runs'))
  assert.ok(calls[1].includes('/v1/runs/newest-run/stream?after=0'))
})

test('postOperatorInstruction posts a steer and echoes it for immediate display', async () => {
  type Seen = { url: string; body: unknown }
  let seen: Seen | null = null
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), body: JSON.parse(String(init?.body)) } as Seen
    return new Response(JSON.stringify({ id: 'iv-77', type: 'steer', node_key: 'reconcile' }), { status: 201 })
  }) as unknown as typeof fetch

  const event = await postOperatorInstruction('https://api.example.com', 'run-1', {
    nodeKey: 'reconcile',
    instruction: 'hold off',
    optionId: 'wait-for-vessel',
    currentSequence: 12,
  }, { fetch: fetchStub })

  const captured = seen as Seen | null
  assert.ok(captured)
  assert.equal(captured!.url, 'https://api.example.com/v1/runs/run-1/interventions')
  assert.deepEqual(captured!.body, {
    type: 'steer',
    node_key: 'reconcile',
    prompt: 'hold off (chose: wait-for-vessel)',
  })

  // The echo carries the server's id as the dedupe key, so when the same
  // intervention arrives on the stream the reducer replaces rather than doubles it.
  assert.equal(event.event_type, 'intervention_requested')
  assert.equal(event.node_key, 'reconcile')
  assert.equal(event.idempotency_key, 'intervention_requested:iv-77')
})
