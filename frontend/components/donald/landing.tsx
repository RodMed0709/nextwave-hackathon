'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * The product landing at /.
 *
 * Playback lives at /runs/<key>; the home page presents and routes. Everything
 * here is static except the "Running right now" strip, which asks the API for
 * live runs once on mount and stays quiet if the answer is an error or nothing.
 */

type CaseCard = {
  runKey: string
  title: string
  client: string
  line: string
  duration: string
  badge?: string
}

const CASES: CaseCard[] = [
  {
    runKey: 'berrios-op4471',
    title: 'MSC changed the vessel on OP-4471',
    client: 'Mueblerías Berríos',
    line: 'An ambient watch catches the swap, a human gate fires above threshold, and a client email is drafted.',
    duration: '~2 min',
    badge: '$3M/yr saved on demurrage — published case study',
  },
  {
    runKey: 'missing-invoice',
    title: 'The invoice that never arrived',
    client: 'Muebles del Sur',
    line: 'The agent grows a new card, emails the supplier, and files a provisional entry.',
    duration: '~2 min',
  },
  {
    runKey: 'replan',
    title: 'The plan changes mid-flight',
    client: 'Nauta operations',
    line: 'A transshipment at Busan rewires the graph live; $690–750 of exposure avoided.',
    duration: '~2 min',
  },
  {
    runKey: 'land-pickup',
    title: 'Land pickup conflict at Berríos',
    client: 'Mueblerías Berríos',
    line: 'Twelve stages, three priced options on the table, $276–414 avoided at $0 spent.',
    duration: '~2 min',
  },
]

const MCP_SNIPPET = `{
  "mcpServers": {
    "donald": {
      "type": "http",
      "url": "https://mcp.usedonald.com/v1/mcp"
    }
  }
}`

type LiveRun = { run_key: string; name: string; status: string }

/**
 * The live strip never shows an error. A landing page that greets a visitor
 * with a failed fetch reads as a broken product; an empty strip with a pointer
 * to the connect block reads as an invitation.
 */
function useLiveRuns(): LiveRun[] {
  const [runs, setRuns] = useState<LiveRun[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)

    fetch('https://api.usedonald.com/v1/runs', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((payload: unknown) => {
        const source = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { runs?: unknown })?.runs)
            ? ((payload as { runs: unknown[] }).runs)
            : []
        const parsed = source
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .filter((item) => typeof item.run_key === 'string' && item.run_key.length > 0)
          .slice(0, 6)
          .map((item) => ({
            run_key: item.run_key as string,
            name: typeof item.name === 'string' && item.name ? item.name : (item.run_key as string),
            status: typeof item.status === 'string' && item.status ? item.status : 'unknown',
          }))
        setRuns(parsed)
      })
      .catch(() => {
        /* Silence is the design: no live runs and a failed API look the same. */
      })
      .finally(() => clearTimeout(timer))

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [])

  return runs
}

function LiveRunsSection() {
  const runs = useLiveRuns()

  return (
    <section className="landing-section" aria-label="Running right now">
      <h2 className="landing-section-title">Running right now</h2>
      {runs.length === 0 ? (
        <p className="landing-live-empty">No live runs at the moment — connect an agent below.</p>
      ) : (
        <ul className="landing-live-list">
          {runs.map((run) => (
            <li key={run.run_key}>
              <Link className="landing-live-row" href={`/runs/${encodeURIComponent(run.run_key)}`}>
                <i className="landing-live-dot" aria-hidden />
                <span className="landing-live-name">{run.name}</span>
                <code className="landing-live-key">{run.run_key}</code>
                <span className="landing-live-status">{run.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Landing() {
  return (
    <main className="landing">
      <div className="landing-inner">
        <header className="landing-hero">
          <img className="landing-logo" src="/donald-logo-official.png" alt="Donald logo" />
          <h1 className="landing-title">
            DONALD<span className="landing-title-dash"> — </span>
            <span className="landing-title-tag">A supervision surface for agents that act</span>
          </h1>
          <p className="landing-thesis">
            An agent that only alerts can be audited by reading the alert. One that acts needs a window — and a
            brake.
          </p>
          <p className="landing-subthesis">
            The interface builds itself from natural language: the operator writes a sentence, the donald-flow
            skill teaches any agent to report, the graph emerges.
          </p>
        </header>

        <section className="landing-section" aria-label="Recorded cases">
          <h2 className="landing-section-title">Watch a real case</h2>
          <div className="landing-cases">
            {CASES.map((card) => (
              <Link key={card.runKey} className="landing-card" href={`/runs/${card.runKey}`}>
                <span className="landing-card-client">{card.client}</span>
                <h3 className="landing-card-title">{card.title}</h3>
                <p className="landing-card-line">{card.line}</p>
                {card.badge && <span className="landing-card-badge">{card.badge}</span>}
                <span className="landing-card-duration">{card.duration}</span>
              </Link>
            ))}
          </div>
        </section>

        <LiveRunsSection />

        <section className="landing-section" aria-label="Connect your agent">
          <h2 className="landing-section-title">Connect your agent</h2>
          <pre className="landing-code">
            <code>{MCP_SNIPPET}</code>
          </pre>
          <p className="landing-connect-note">
            Point any MCP-capable agent here and give it the donald-flow skill; its work appears above as it
            happens.
          </p>
        </section>
      </div>
    </main>
  )
}
