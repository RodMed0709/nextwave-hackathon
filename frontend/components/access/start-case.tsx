'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, UserRound } from 'lucide-react'

const RUN_KEY = 'berrios-op4471'

const CLIENT_NAME = 'Mueblerías Berríos — Puerto Rico'

const STANDING_PROMPT =
  'We are Mueblerías Berríos, a furniture retailer in Puerto Rico. We import from Asia ' +
  'through MSC and other carriers, and at any moment we have dozens of operations on the ' +
  'water, several of them feeding committed store deliveries.\n\n' +
  'Watch every one of them, around the clock. When a carrier changes a vessel, a routing ' +
  'or an ETA, find out why it happened, check it against our original booking, and measure ' +
  'what it costs us in days and dollars. Solve what can be solved without us — and bring ' +
  'us the decision only when money or a committed delivery is at risk.\n\n' +
  'Handle the communication yourself: keep our operations director briefed and update the ' +
  'client the moment a routing is confirmed.'

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
          rows={11}
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
