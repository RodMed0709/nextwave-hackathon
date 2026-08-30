'use client'

import type { ReactNode } from 'react'
import type { OperationalStageId, OperationalStageSummary } from '@/lib/donald/operational-stages'

type OperationalStageProps = {
  stage: OperationalStageSummary
  /** One live line under the title — e.g. "62 events · last activity 05:21:14". */
  liveNote?: string | null
  children: ReactNode
}

function stageStateLabel(state: OperationalStageSummary['state']): string {
  switch (state) {
    case 'healthy': return 'Live'
    case 'in-progress': return 'Working'
    case 'needs-human': return 'Needs human'
    case 'complete': return 'Complete'
    case 'empty': return 'Idle'
  }
}

export function stageDomId(stageId: OperationalStageId): string {
  return `operational-stage-${stageId}`
}

export function OperationalStage({
  stage,
  liveNote = null,
  children,
}: OperationalStageProps) {
  const count = stage.totalActions === 0 ? 'Idle' : `${stage.completeActions}/${stage.totalActions}`

  return (
    <section
      className={`operational-stage-accordion expanded stage-${stage.id} stage-${stage.state}`}
      id={stageDomId(stage.id)}
    >
      {/* The lane must explain itself: what this section IS, in plain words,
          without the viewer having heard the pitch. */}
      <header className="operational-stage-header">
        <div className="operational-stage-title">
          <span className="stage-eyebrow">
            {stage.id === 'above' && <i className="live-dot" />}
            {stage.eyebrow}
          </span>
          <h2>{stage.title}</h2>
          <p>{stage.description}</p>
          {liveNote && <small className="stage-live-note">{liveNote}</small>}
        </div>
        <div className="operational-stage-status">
          <strong>{stageStateLabel(stage.state)}</strong>
          <span>{count}</span>
        </div>
      </header>
      <div
        className="operational-stage-body"
        id={`${stageDomId(stage.id)}-body`}
      >
        <div className="operational-stage-content">
          {children}
        </div>
      </div>
    </section>
  )
}
