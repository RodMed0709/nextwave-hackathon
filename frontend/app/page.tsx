import { redirect } from 'next/navigation'

import { Landing } from '@/components/donald/landing'

type HomePageProps = {
  searchParams: Promise<{ run?: string | string[] }>
}

/**
 * The home page is the product landing. Playback lives at /runs/<key>.
 *
 * `/?run=<key>` used to be the watch link, so links already shared keep
 * working: they land here and are forwarded to the run's own page.
 */
export default async function Page({ searchParams }: HomePageProps) {
  const value = (await searchParams).run
  const requestedRunKey = (Array.isArray(value) ? value[0] : value)?.trim()
  if (requestedRunKey) redirect(`/runs/${encodeURIComponent(requestedRunKey)}`)
  return <Landing />
}
