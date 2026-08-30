'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, UserRound } from 'lucide-react'

const RUN_KEY = 'berrios-op4471'

const CLIENT_NAME = 'Mueblerías Berríos — Puerto Rico'

const STANDING_PROMPT =
  'Watch every operation on our book, around the clock. If a carrier changes a vessel, ' +
  'routing or ETA, find out why, measure what it costs us, and bring me the decision only ' +
  'when a committed delivery is at risk. Then handle the communication yourself.'

/**
 * The second screen of the demo flow: who the client is and what they asked
 * NAUTA to handle — the client speaks to their forwarder, never to Donald.
 * Donald is the operational brain Nauta runs the request on, which is the
 * reveal the next screen delivers. Editable so a demo can improvise,
 * prefilled so it never has to be.
 */
export function StartCase() {
  const router = useRouter()
  const [prompt, setPrompt] = useState(STANDING_PROMPT)
  const [leaving, setLeaving] = useState(false)

  const launch = () => {
    setLeaving(true)
    window.setTimeout(() => router.push(`/runs/${RUN_KEY}`), 380)
  }

  return (
    <main className={`start-case-page${leaving ? ' entering' : ''}`}>
      <section className="start-case-shell" aria-label="Start a case">
        <span className="start-case-eyebrow">Client workspace</span>
        <h1><UserRound aria-hidden="true" size={26} /> {CLIENT_NAME}</h1>
        <p className="start-case-lede">What they asked Nauta:</p>
        <textarea
          aria-label="Standing request to Nauta"
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          value={prompt}
        />
        <p className="start-case-bridge">
          <strong>Donald</strong> reads Nauta&apos;s agents and renders its own live interface.
        </p>
        <button disabled={leaving} onClick={launch} type="button">
          See Donald run it <ArrowRight aria-hidden="true" size={16} />
        </button>
      </section>
    </main>
  )
}
