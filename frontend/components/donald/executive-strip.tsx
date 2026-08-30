'use client'

import { Check } from 'lucide-react'
import type { ExecutivePhase } from '@/lib/donald/executive-phases'

/**
 * The three-step banner over the detailed canvas: Watching → Solving → Acting.
 * Big enough to carry a pitch from the back of the room while the full graph
 * executes underneath it.
 */
export function ExecutiveStrip({ phases }: { phases: ExecutivePhase[] }) {
  return (
    <section aria-label="Run at a glance" className="executive-strip">
      {phases.map((phase, index) => (
        <div className={`executive-phase state-${phase.state}`} key={phase.id}>
          <span className="executive-phase-index">{index + 1}</span>
          <div className="executive-phase-copy">
            <strong>{phase.title}</strong>
            <small>{phase.detail}</small>
          </div>
          <span className="executive-phase-state">
            {phase.id === 'watch' && phase.state === 'running' && <><i className="live-dot" /> ALWAYS ON</>}
            {phase.id !== 'watch' && phase.state === 'running' && <><i className="live-dot" /> IN PROGRESS</>}
            {phase.state === 'done' && <><Check aria-hidden="true" size={13} /> DONE</>}
            {phase.state === 'waiting' && 'UP NEXT'}
          </span>
        </div>
      ))}
    </section>
  )
}
