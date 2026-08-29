import { isDonaldEvent, type DonaldEvent } from './types'

type Wait = (milliseconds: number, signal?: AbortSignal) => Promise<void>
type Fetch = typeof fetch

export type SourceReadOptions = {
  immediate?: boolean
  signal?: AbortSignal
}

export type DonaldEventSource = AsyncIterable<DonaldEvent> & {
  next(options?: SourceReadOptions): Promise<IteratorResult<DonaldEvent, undefined>>
  reset(): void
}

type SourceOptions = {
  fetch?: Fetch
  wait?: Wait
}

export type OperatorInstructionInput = {
  nodeKey: string
  instruction: string
  optionId?: string | null
  currentSequence: number
}

// Keep the backend write contract in one place until the Donald API publishes a typed client.
export const OPERATOR_INSTRUCTIONS_PATH = 'operator_instructions'

const defaultWait: Wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason)
    return
  }
  const timer = setTimeout(resolve, milliseconds)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(signal.reason)
  }, { once: true })
})

export function parseEventStream(text: string): DonaldEvent[] {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value: unknown = JSON.parse(line)
    if (!isDonaldEvent(value)) throw new Error(`Invalid Donald event at line ${index + 1}`)
    return value
  })
}

export function recordedSource(options: SourceOptions = {}): DonaldEventSource {
  const fetcher = options.fetch ?? fetch
  const wait = options.wait ?? defaultWait
  let index = 0
  let eventsPromise: Promise<DonaldEvent[]> | null = null

  const load = () => {
    eventsPromise ??= fetcher('/api/donald-recording').then(async (response) => {
      if (!response.ok) throw new Error(`Recording request failed with ${response.status}`)
      return parseEventStream(await response.text())
    })
    return eventsPromise
  }

  const source: DonaldEventSource = {
    async next(readOptions = {}) {
      const events = await load()
      const event = events[index]
      if (!event) return { done: true, value: undefined }
      if (!readOptions.immediate && index > 0) {
        const previousTime = Date.parse(events[index - 1].occurred_at)
        const currentTime = Date.parse(event.occurred_at)
        await wait(Math.max(0, currentTime - previousTime), readOptions.signal)
      }
      index += 1
      return { done: false, value: event }
    },
    reset() {
      index = 0
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return source
}

/**
 * Donald's SSE delta as it comes off the wire.
 *
 * The server addresses nodes by uuid internally but sends `node_key` alongside,
 * because every other part of this protocol — the agent tools, the graph, the
 * operator controls — is keyed on the agent-chosen key. We read the key and
 * ignore the uuid.
 */
type DonaldDelta = {
  sequence: number
  graph_revision?: number
  event_type: string
  occurred_at: string
  node_key?: string
  agent_label?: string
  idempotency_key?: string
  payload?: Record<string, unknown>
}

function deltaToEvent(delta: DonaldDelta): DonaldEvent {
  return {
    sequence: delta.sequence,
    event_type: delta.event_type,
    occurred_at: delta.occurred_at,
    // The reducer's validator accepts `string | null` and rejects undefined, so
    // absent fields have to be nulled rather than passed through.
    agent_label: delta.agent_label ?? null,
    node_key: delta.node_key ?? null,
    // The server derives a stable key per mutation; falling back to the sequence
    // keeps the reducer's dedupe working even if one is ever missing.
    idempotency_key: delta.idempotency_key ?? `seq-${delta.sequence}`,
    payload: delta.payload ?? {},
  }
}

function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  // Tolerate being configured with or without the /v1 prefix.
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

/**
 * Live source: Donald's server-sent event stream for one run.
 *
 * Replaces the previous polling implementation. Polling cost a second of
 * latency on every change and asked the server for the same rows repeatedly;
 * the stream pushes each delta as it commits, and `?after=` makes reconnection
 * exact — the server replays everything past the cursor, so a dropped
 * connection loses nothing and duplicates nothing.
 *
 * Events are buffered rather than dropped when the consumer is slower than the
 * stream, because the reducer must see every sequence: a gap is what tells it
 * to resync, and manufacturing gaps here would trigger that for no reason.
 */
export function liveSource(baseUrl: string, runKey: string | null, options: SourceOptions = {}): DonaldEventSource {
  const fetcher = options.fetch ?? fetch
  const wait = options.wait ?? defaultWait

  let queue: DonaldEvent[] = []
  let lastSequence = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let buffer = ''
  let finished = false
  let resolvedKey: string | null = runKey

  /**
   * A null runKey means "whatever is running now", which is what the viewer
   * wants when it is opened cold. The run list is newest-first, so the first
   * entry is the answer. Resolved once and remembered: switching runs mid-stream
   * would corrupt the reducer's sequence cursor.
   */
  const resolveRunKey = async (signal?: AbortSignal): Promise<string> => {
    if (resolvedKey) return resolvedKey
    const response = await fetcher(`${apiRoot(baseUrl)}/runs`, { signal })
    if (!response.ok) throw new Error(`Donald run list failed with ${response.status}`)
    const body = await response.json() as { runs?: Array<{ run_key?: string }> }
    const first = body.runs?.[0]?.run_key
    if (!first) throw new Error('Donald has no runs to display')
    resolvedKey = first
    return first
  }

  const connect = async (signal?: AbortSignal) => {
    const key = await resolveRunKey(signal)
    const url = `${apiRoot(baseUrl)}/runs/${encodeURIComponent(key)}/stream?after=${lastSequence}`
    const response = await fetcher(url, {
      signal,
      headers: { accept: 'text/event-stream' },
    })
    if (!response.ok) throw new Error(`Donald stream failed with ${response.status}`)
    if (!response.body) throw new Error('Donald stream returned no body')
    reader = response.body.getReader()
    buffer = ''
  }

  /** Pulls one chunk and appends any complete SSE frames to the queue. */
  const pump = async (signal?: AbortSignal): Promise<void> => {
    if (!reader) await connect(signal)
    if (!reader) return

    const { done, value } = await reader.read()
    if (done) {
      // The server closed the stream. Reconnecting from lastSequence is safe and
      // is the normal path when a run is idle behind a proxy that reaps it.
      reader = null
      await wait(500, signal)
      return
    }

    buffer += new TextDecoder().decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        // ": keepalive" comments hold the connection open and carry no data.
        if (!line.startsWith('data: ')) continue
        try {
          const delta = JSON.parse(line.slice(6)) as DonaldDelta
          if (typeof delta.sequence !== 'number') continue
          if (delta.sequence <= lastSequence) continue
          lastSequence = delta.sequence
          queue.push(deltaToEvent(delta))
        } catch {
          // A single unparseable frame must not kill the stream; the cursor has
          // not moved, so a reconnect would fetch it again.
        }
      }
    }
  }

  const source: DonaldEventSource = {
    async next(readOptions = {}) {
      while (queue.length === 0) {
        if (finished) return { done: true, value: undefined }
        try {
          await pump(readOptions.signal)
        } catch (error) {
          if (readOptions.signal?.aborted) throw error
          // Transient: back off and let the next call retry from the cursor.
          reader = null
          await wait(1_000, readOptions.signal)
        }
      }
      const event = queue.shift()
      if (!event) return { done: true, value: undefined }
      return { done: false, value: event }
    },
    reset() {
      queue = []
      lastSequence = 0
      reader = null
      buffer = ''
      finished = false
      resolvedKey = runKey
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return source
}

/** Retained as the name the app already imports. */
export const apiSource = liveSource

/**
 * Raise an operator instruction (a steer) against one node.
 *
 * Returns the event the server recorded, so the caller can apply it immediately
 * instead of waiting for it to arrive on the stream. Applying it twice is
 * harmless: the reducer dedupes on idempotency_key, and the stream will deliver
 * the same event with the same key.
 */
export async function postOperatorInstruction(
  baseUrl: string | null,
  runKey: string,
  input: OperatorInstructionInput,
  options: Pick<SourceOptions, 'fetch'> = {},
): Promise<DonaldEvent> {
  const fetcher = options.fetch ?? fetch
  if (!baseUrl) throw new Error('Operator instructions need a Donald API base URL')

  const instruction = input.optionId
    ? `${input.instruction} (chose: ${input.optionId})`
    : input.instruction

  const response = await fetcher(
    `${apiRoot(baseUrl)}/runs/${encodeURIComponent(runKey)}/interventions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'steer',
        node_key: input.nodeKey,
        prompt: instruction,
      }),
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Operator instruction failed with ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  const value = await response.json() as { id?: string; node_key?: string }
  // The POST acknowledges the request; the authoritative event arrives on the
  // stream moments later. Synthesise a local echo so the UI reacts at once,
  // carrying the server's id as the dedupe key so the streamed copy replaces it
  // rather than duplicating it.
  return {
    sequence: input.currentSequence + 0.5,
    event_type: 'intervention_requested',
    occurred_at: new Date().toISOString(),
    agent_label: null,
    node_key: value.node_key ?? input.nodeKey,
    idempotency_key: `intervention_requested:${value.id ?? instruction}`,
    payload: { type: 'steer', prompt: instruction, status: 'registered' },
  }
}
