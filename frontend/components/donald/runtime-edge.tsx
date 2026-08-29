'use client'

import { memo, type CSSProperties } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export type RuntimeEdgeStatus = 'WAITING' | 'ACTIVE' | 'DONE' | 'BLOCKED' | 'FAILED' | 'SKIPPED'

export type RuntimeEdgeData = {
  status: RuntimeEdgeStatus
  enterDelayMs?: number
  exiting?: boolean
}

function RuntimeEdgeComponent(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath(props)
  const data = (props.data ?? {}) as RuntimeEdgeData
  const status = data.status ?? 'WAITING'
  const statusClass = status.toLowerCase()
  const enterDelayMs = data.enterDelayMs ?? 0

  const animationStyle = { '--edge-enter-delay': `${enterDelayMs}ms` } as CSSProperties
  const edgeClass = [
    'runtime-edge',
    `runtime-edge-${statusClass}`,
    data.exiting ? 'runtime-edge-exiting' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <BaseEdge path={edgePath} className={edgeClass} style={animationStyle} />
      {!data.exiting && (
        <path
          d={edgePath}
          pathLength={1}
          className={`runtime-edge-trace runtime-edge-trace-${statusClass}`}
          style={animationStyle}
        />
      )}
      {data.exiting && (
        <path
          d={edgePath}
          pathLength={1}
          className={`runtime-edge-retract runtime-edge-trace-${statusClass}`}
        />
      )}
    </>
  )
}

export const RuntimeEdge = memo(RuntimeEdgeComponent)
