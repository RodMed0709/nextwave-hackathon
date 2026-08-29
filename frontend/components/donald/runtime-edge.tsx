'use client'

import { memo, useEffect, useState, type CSSProperties } from 'react'
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export type RuntimeEdgeStatus = 'WAITING' | 'ACTIVE' | 'DONE' | 'BLOCKED' | 'FAILED' | 'SKIPPED'

export type RuntimeEdgeData = {
  status: RuntimeEdgeStatus
  signalKey: number
  selected?: boolean
  enterDelayMs?: number
  exiting?: boolean
}

function RuntimeEdgeComponent(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath(props)
  const data = (props.data ?? {}) as RuntimeEdgeData
  const status = data.status ?? 'WAITING'
  const statusClass = status.toLowerCase()
  const selectedClass = data.selected ? 'runtime-edge-selected' : ''
  const enterDelayMs = data.enterDelayMs ?? 0
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntered(true)
      return
    }
    const timer = window.setTimeout(() => setEntered(true), enterDelayMs + 340)
    return () => window.clearTimeout(timer)
  }, [enterDelayMs])

  const animationStyle = { '--edge-enter-delay': `${enterDelayMs}ms` } as CSSProperties
  const edgeClass = [
    'runtime-edge',
    `runtime-edge-${statusClass}`,
    selectedClass,
    !entered && !data.exiting ? 'runtime-edge-entering' : '',
    data.exiting ? 'runtime-edge-exiting' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <BaseEdge path={edgePath} className={edgeClass} style={animationStyle} />
      {!entered && !data.exiting && (
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
      {status === 'ACTIVE' && entered && !data.exiting && (
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
