import { DonaldAccess } from '@/components/access/donald-access'
import { redirect } from 'next/navigation'

type HomePageProps = {
  searchParams: Promise<{ run?: string | string[] }>
}

export default async function Page({ searchParams }: HomePageProps) {
  const value = (await searchParams).run
  const requestedRunKey = Array.isArray(value) ? value[0] : value
  if (requestedRunKey?.trim()) redirect(`/runs/${encodeURIComponent(requestedRunKey.trim())}`)

  return <DonaldAccess />
}
