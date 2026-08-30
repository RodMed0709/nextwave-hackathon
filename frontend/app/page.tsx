import { RunViewer } from '@/components/donald/run-viewer'

type HomePageProps = {
  searchParams: Promise<{ run?: string | string[] }>
}

export default async function Page({ searchParams }: HomePageProps) {
  const value = (await searchParams).run
  const requestedRunKey = Array.isArray(value) ? value[0] : value
  return <RunViewer requestedRunKey={requestedRunKey?.trim() || null} />
}
