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

function eventsFromApi(value: unknown): DonaldEvent[] {
  const candidate = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).events)
      ? (value as Record<string, unknown>).events as unknown[]
      : null
  if (!candidate || !candidate.every(isDonaldEvent)) throw new Error('Invalid Donald API response')
  return [...candidate].sort((left, right) => left.sequence - right.sequence)
}

export function apiSource(baseUrl: string, runKey: string, options: SourceOptions = {}): DonaldEventSource {
  const fetcher = options.fetch ?? fetch
  const wait = options.wait ?? defaultWait
  let lastSequence = 0
  let buffer: DonaldEvent[] = []

  const source: DonaldEventSource = {
    async next(readOptions = {}) {
      while (buffer.length === 0) {
        const endpoint = new URL('agent_events', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
        endpoint.searchParams.set('run_uuid', runKey)
        endpoint.searchParams.set('sequence_gt', String(lastSequence))
        const response = await fetcher(endpoint, { signal: readOptions.signal })
        if (!response.ok) throw new Error(`Donald API request failed with ${response.status}`)
        const payload: unknown = await response.json()
        buffer = eventsFromApi(payload).filter((event) => event.sequence > lastSequence)
        if (buffer.length === 0) await wait(1_000, readOptions.signal)
      }
      const event = buffer.shift()
      if (!event) return { done: true, value: undefined }
      lastSequence = event.sequence
      return { done: false, value: event }
    },
    reset() {
      lastSequence = 0
      buffer = []
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return source
}
