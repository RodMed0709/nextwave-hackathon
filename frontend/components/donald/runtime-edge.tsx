'use client'

import { memo } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export type RuntimeEdgeStatus = 'WAITING' | 'ACTIVE' | 'DONE' | 'BLOCKED' | 'FAILED' | 'SKIPPED'

export type RuntimeEdgeData = {
  status: RuntimeEdgeStatus
  signalKey: number
  selected?: boolean
}

function RuntimeEdgeComponent(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath(props)
  const data = (props.data ?? {}) as RuntimeEdgeData
  const status = data.status ?? 'WAITING'
  const statusClass = status.toLowerCase()
  const selectedClass = data.selected ? 'runtime-edge-selected' : ''

  return (
    <>
      <BaseEdge path={edgePath} className={`runtime-edge runtime-edge-${statusClass} ${selectedClass}`} />
      {status === 'ACTIVE' && (
        <g className="runtime-edge-signal" key={data.signalKey}>
          <circle r="4">
            <animateMotion dur=".92s" path={edgePath} fill="freeze" />
          </circle>
        </g>
      )}
    </>
  )
}

export const RuntimeEdge = memo(RuntimeEdgeComponent)
