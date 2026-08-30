import { isDonaldEvent, sanitizeSubtasks, type DonaldEvent } from './types'

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
  /** Which recorded run to play. Omitted plays the default one. */
  recording?: string | null
}

export type OperatorInstructionInput = {
  nodeKey: string
  instruction: string
  optionId?: string | null
  currentSequence: number
  /**
   * 'steer' redirects a step, 'stop' asks the agent to abandon it. Both are
   * advisory - these agents are not ours to control - so the difference is in
   * what the agent is asked to do, not in any power we have over it.
   */
  type?: 'stop' | 'steer'
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
    return { ...value, payload: adaptPayload(value.payload) }
  })
}

export function recordedSource(options: SourceOptions = {}): DonaldEventSource {
  const fetcher = options.fetch ?? fetch
  const wait = options.wait ?? defaultWait
  let index = 0
  let eventsPromise: Promise<DonaldEvent[]> | null = null

  const load = () => {
    const query = options.recording ? `?recording=${encodeURIComponent(options.recording)}` : ''
    eventsPromise ??= fetcher(`/api/donald-recording${query}`).then(async (response) => {
      if (!response.ok) throw new Error(`Recording request failed with ${response.status}`)
      return parseEventStream(await response.text())
    }).catch((error: unknown) => {
      // Never cache a rejection: one failed first fetch would otherwise leave
      // the page dead until a full reload.
      eventsPromise = null
      throw error
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

function adaptPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(payload, 'subtasks')) return payload
  const subtasks = sanitizeSubtasks(payload.subtasks)
  if (subtasks !== null) return { ...payload, subtasks }
  const { subtasks: _malformed, ...rest } = payload
  return rest
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
    payload: adaptPayload(delta.payload ?? {}),
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

  // Recorded demos mirror createSource's recorded/live split: a null baseUrl
  // means the run only exists in a bundled recording, so the write goes to the
  // local mock route — the pre-hybrid flow. Posting a recorded run to the real
  // API asks it about a run it never started ("call start_run first").
  if (!baseUrl) {
    const response = await fetcher('/api/donald-recording', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        run_uuid: runKey,
        node_key: input.nodeKey,
        instruction: input.instruction,
        option_id: input.optionId ?? null,
        current_sequence: input.currentSequence,
      }),
    })
    if (!response.ok) throw new Error(`Operator instruction failed with ${response.status}`)
    const value: unknown = await response.json()
    if (!isDonaldEvent(value)) throw new Error('Invalid operator instruction response')
    // Renumbered to a half-step so applying the echo cannot swallow the next
    // recorded event: the reducer drops anything at or below last_sequence, and
    // the mock numbers its echo with the integer the recording will use next.
    return { ...value, sequence: input.currentSequence + 0.001 }
  }

  const instruction = input.optionId
    ? `${input.instruction} (chose: ${input.optionId})`
    : input.instruction

  const type = input.type ?? 'steer'
  const response = await fetcher(
    `${apiRoot(baseUrl)}/runs/${encodeURIComponent(runKey)}/interventions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
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
    sequence: input.currentSequence + 0.001,
    event_type: 'intervention_requested',
    occurred_at: new Date().toISOString(),
    agent_label: null,
    node_key: value.node_key ?? input.nodeKey,
    idempotency_key: `intervention_requested:${value.id ?? instruction}`,
    payload: {
      type,
      prompt: instruction,
      status: 'registered',
      intervention_id: value.id,
      // Marks this as a person steering rather than the agent asking. The
      // reducer uses it to decide whether the step is now blocked: an agent that
      // asks a question has stopped, an operator who steers has not stopped
      // anything, and drawing the step as blocked would claim a brake we do not
      // have.
      origin: 'operator',
    },
  }
}

export type PromptSuggestion = { label: string; prompt: string }

/**
 * Suggested instructions for one step, generated server-side from this run's own
 * content so they name the documents and numbers actually in play.
 *
 * Failure is not propagated: suggestions are an assist, and a step you cannot
 * get advice on is still a step you can type an instruction to. Returning an
 * empty list simply renders no chips.
 */
export async function fetchPromptSuggestions(
  baseUrl: string | null,
  runKey: string,
  nodeKey: string,
  options: Pick<SourceOptions, 'fetch'> & { signal?: AbortSignal } = {},
): Promise<PromptSuggestion[]> {
  if (!baseUrl) return []
  const fetcher = options.fetch ?? fetch
  try {
    const response = await fetcher(
      `${apiRoot(baseUrl)}/runs/${encodeURIComponent(runKey)}/nodes/${encodeURIComponent(nodeKey)}/suggestions`,
      { signal: options.signal },
    )
    if (!response.ok) return []
    const body = await response.json() as { suggestions?: unknown }
    if (!Array.isArray(body.suggestions)) return []
    return body.suggestions.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const { label, prompt } = item as Record<string, unknown>
      if (typeof label !== 'string' || typeof prompt !== 'string') return []
      return [{ label, prompt }]
    }).slice(0, 3)
  } catch {
    return []
  }
}
