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

/**
 * Re-render only when something about THIS edge changed.
 *
 * The default memo comparison never held: `data` is rebuilt as a fresh object
 * for every edge on every event, so each of a run's ~90 events re-rendered every
 * edge in the graph. Comparing the values that actually reach the DOM — the four
 * endpoint coordinates and the three data fields — is what turns a replay from a
 * storm of re-renders into a handful.
 */
export const RuntimeEdge = memo(RuntimeEdgeComponent, (previous, next) => {
  const a = (previous.data ?? {}) as RuntimeEdgeData
  const b = (next.data ?? {}) as RuntimeEdgeData
  return (
    previous.sourceX === next.sourceX &&
    previous.sourceY === next.sourceY &&
    previous.targetX === next.targetX &&
    previous.targetY === next.targetY &&
    previous.sourcePosition === next.sourcePosition &&
    previous.targetPosition === next.targetPosition &&
    a.status === b.status &&
    a.enterDelayMs === b.enterDelayMs &&
    a.exiting === b.exiting
  )
})
