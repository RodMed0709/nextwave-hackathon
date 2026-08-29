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

export async function generateMetadata({ params }: RunPageProps) {
  const { runKey } = await params
  return { title: `${decodeURIComponent(runKey)} · DONALD` }
}
