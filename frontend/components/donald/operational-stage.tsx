'use client'

import type { ReactNode } from 'react'
import type { OperationalStageId, OperationalStageSummary } from '@/lib/donald/operational-stages'

type OperationalStageProps = {
  stage: OperationalStageSummary
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
  children,
}: OperationalStageProps) {
  const count = stage.totalActions === 0 ? 'Idle' : `${stage.completeActions}/${stage.totalActions}`

  return (
    <section
      className={`operational-stage-accordion expanded stage-${stage.id} stage-${stage.state}`}
      id={stageDomId(stage.id)}
    >
      <header className="operational-stage-header">
        <div className="operational-stage-title">
          {stage.id === 'above'
            ? <span className="stage-live"><i className="live-dot" /> LIVE</span>
            : stage.id === 'below' ? <h2>Below the line</h2> : null}
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
