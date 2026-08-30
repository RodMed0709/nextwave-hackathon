'use client'

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { ExecutivePhase } from '@/lib/donald/executive-phases'

/**
 * The three-step banner — and it WORKS, it does not just sit there:
 * Watching carries the live ambient ticker, Solving names the step running
 * right now, Acting names the last thing that went out. One glance answers
 * "where are we and what is happening", no scrolling.
 */
export function ExecutiveStrip({ phases, watchContent, solvingNow, actingNow }: {
  phases: ExecutivePhase[]
  watchContent?: ReactNode
  solvingNow?: string | null
  actingNow?: string | null
}) {
  const noteFor = (phase: ExecutivePhase): string | null => {
    if (phase.id === 'solve') return solvingNow ?? null
    if (phase.id === 'act') return actingNow ?? null
    return null
  }
  return (
    <section aria-label="Run at a glance" className="executive-strip">
      {phases.map((phase, index) => {
        const note = noteFor(phase)
        return (
          <div className={`executive-phase state-${phase.state}`} key={phase.id}>
            <div className="executive-phase-head">
              <span className="executive-phase-index">{index + 1}</span>
              <strong>{phase.title}</strong>
              <span className="executive-phase-state">
                {phase.id === 'watch' && phase.state === 'running' && <><i className="live-dot" /> ALWAYS ON</>}
                {phase.id !== 'watch' && phase.state === 'running' && <><i className="live-dot" /> IN PROGRESS</>}
                {phase.state === 'done' && <><Check aria-hidden="true" size={13} /> DONE</>}
                {phase.state === 'waiting' && 'UP NEXT'}
              </span>
            </div>
            {phase.id === 'watch' && watchContent}
            {note && <p className="executive-phase-note">{note}</p>}
            {phase.id !== 'watch' && !note && <p className="executive-phase-note muted">{phase.detail}</p>}
          </div>
        )
      })}
    </section>
  )
}
