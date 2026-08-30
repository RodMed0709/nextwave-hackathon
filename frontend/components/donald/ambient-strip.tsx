'use client'

import { useEffect, useState } from 'react'
import type { RunNode } from '@/lib/donald/types'

/**
 * The Watch as a compact perpetual loop — and visibly ALIVE.
 *
 * These three tasks never finish, so instead of DONE badges each one ticks
 * through the small concrete things it is doing right now, with a running
 * count. The activity is presentational (the strip is a summary, not a second
 * event log), which also means it keeps breathing on a finished recording —
 * which is the true story: the watch outlives the case.
 */
const ACTIVITY: readonly (readonly string[])[] = [
  [
    'Carrier feed update received',
    'Booking confirmation parsed',
    'BL draft stored',
    'Schedule notice read',
    'Terminal update ingested',
  ],
  [
    'Update matched to OP-4471',
    'Duplicate notice discarded',
    'New document linked to its operation',
    'Sender identified — MSC',
  ],
  [
    'Schedule picture refreshed',
    'ETA watch: no drift',
    'Milestones on track',
    'Container status confirmed',
  ],
]

const BASE_COUNTS = [38, 24, 51]
const TICK_MS = 2_400

export function AmbientStrip({ nodes }: { nodes: RunNode[] }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="ambient-strip">
      <div className="ambient-items">
        {nodes.map((node, index) => {
          const feed = ACTIVITY[index % ACTIVITY.length]
          const message = feed[tick % feed.length]
          const count = BASE_COUNTS[index % BASE_COUNTS.length] + tick
          return (
            <div className="ambient-item" key={node.node_key} title={node.output_summary?.detail ?? undefined}>
              <span className="ambient-loop" aria-hidden="true" />
              <div className="ambient-copy">
                <strong>{node.label}</strong>
                <small className="ambient-activity" key={message}>{message}</small>
              </div>
              <span className="ambient-count">#{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
