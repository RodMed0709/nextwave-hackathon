import { RunViewer } from '@/components/donald/run-viewer'

type RunPageProps = {
  params: Promise<{ runKey: string }>
}

/**
 * A run's own page: /runs/<run_key>
 *
 * Every run needs a link that can be handed to someone so they can follow along,
 * and a path reads better than a query string when it is pasted into a message.
 * `/?run=<key>` still works — see app/page.tsx — so links already shared stay
 * valid.
 *
 * The key is the agent-supplied run_key, not a uuid, which is what makes these
 * URLs predictable: an agent that knows its own run_key knows its watch link
 * before the run has produced a single event.
 */
export default async function RunPage({ params }: RunPageProps) {
  const { runKey } = await params
  return <RunViewer requestedRunKey={decodeURIComponent(runKey).trim() || null} />
}

/**
 * The browser tab shows the run's real name when the API knows one.
 *
 * Fetched server-side rather than left to the client, because the tab title is
 * read before any stream has connected — and a tab reading `nauta-detention-002`
 * tells the person nothing about which of their four open tabs is the one about
 * the detention exposure. Falls back to the key if the lookup fails: a wrong
 * title is worse than a plain one, and a run page must never fail to render
 * because a title lookup timed out.
 */
export async function generateMetadata({ params }: RunPageProps) {
  const { runKey } = await params
  const key = decodeURIComponent(runKey)
  const base = process.env.NEXT_PUBLIC_DONALD_API
  if (base) {
    try {
      const response = await fetch(
        `${base.replace(/\/+$/, '')}/runs/${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(3_000), next: { revalidate: 30 } },
      )
      if (response.ok) {
        const body = await response.json() as { run?: { name?: string } }
        const name = body.run?.name?.trim()
        if (name) return { title: `${name} · DONALD` }
      }
    } catch {
      // Fall through to the key.
    }
  }
  return { title: `${key} · DONALD` }
}
