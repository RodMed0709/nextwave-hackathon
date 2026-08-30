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
export function ExecutiveStrip({ phases, watchContent, solvingNow, actingNow, watchAlert = false, renderPending = false, onRender }: {
  phases: ExecutivePhase[]
  watchContent?: ReactNode
  solvingNow?: string | null
  actingNow?: string | null
  /** The watch caught something: the Watching cell turns amber. */
  watchAlert?: boolean
  /** True until the operator presses Render — the button glows, waiting. */
  renderPending?: boolean
  onRender?: () => void
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
        const alerting = phase.id === 'watch' && watchAlert && renderPending
        return (
          <div className={`executive-phase state-${phase.state}${alerting ? ' state-alert' : ''}`} key={phase.id}>
            <div className="executive-phase-head">
              <span className="executive-phase-index">{index + 1}</span>
              <strong>{phase.title}</strong>
              <span className="executive-phase-state">
                {alerting && 'CAUGHT SOMETHING'}
                {!alerting && phase.id === 'watch' && <><i className="live-dot" /> NINA · ALWAYS ON</>}
                {!alerting && phase.id !== 'watch' && phase.state === 'running' && <><i className="live-dot" /> IN PROGRESS</>}
                {!alerting && phase.state === 'done' && <><Check aria-hidden="true" size={13} /> DONE</>}
                {!alerting && phase.id !== 'watch' && phase.state === 'waiting' && 'UP NEXT'}
              </span>
            </div>
            {phase.id === 'watch' && watchContent}
            {alerting && onRender && (
              <button className="render-button" onClick={onRender} type="button">
                Render the response
              </button>
            )}
            {note && <p className="executive-phase-note">{note}</p>}
            {phase.id !== 'watch' && !note && <p className="executive-phase-note muted">{phase.detail}</p>}
          </div>
        )
      })}
    </section>
  )
}
