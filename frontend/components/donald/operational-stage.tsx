'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { OperationalStageId, OperationalStageSummary } from '@/lib/donald/operational-stages'

type OperationalStageAccordionProps = {
  stage: OperationalStageSummary
  expanded: boolean
  onToggle: () => void
  children: ReactNode
  transitions: string[]
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

export function OperationalStageAccordion({
  stage,
  expanded,
  onToggle,
  children,
  transitions,
}: OperationalStageAccordionProps) {
  const count = stage.totalActions === 0
    ? 'No active actions'
    : `${stage.completeActions} of ${stage.totalActions} actions complete`

  return (
    <section
      className={`operational-stage-accordion stage-${stage.id} stage-${stage.state}${expanded ? ' expanded' : ' collapsed'}`}
      id={stageDomId(stage.id)}
    >
      <header className="operational-stage-header">
        <div className="operational-stage-title">
          <span className="stage-eyebrow">{stage.eyebrow}</span>
          <div>
            <h2>{stage.title}</h2>
            <p>{expanded ? stage.description : stage.agentLabels.length > 0 ? stage.agentLabels.join(' / ') : stage.description}</p>
          </div>
        </div>
        <div className="operational-stage-status">
          <strong>{stageStateLabel(stage.state)}</strong>
          <span>{count}</span>
        </div>
        <button
          aria-controls={`${stageDomId(stage.id)}-body`}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${stage.eyebrow}: ${stage.title}`}
          className="stage-toggle"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          type="button"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </header>
      <div
        className="operational-stage-body"
        id={`${stageDomId(stage.id)}-body`}
      >
        <div className="operational-stage-capabilities">
          {stage.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
        </div>
        {transitions.length > 0 && (
          <div className="stage-transition-list" aria-label="Stage transitions">
            {transitions.map((transition) => <span key={transition}>{transition}</span>)}
          </div>
        )}
        <div className="operational-stage-content">
          {children}
        </div>
      </div>
    </section>
  )
}
