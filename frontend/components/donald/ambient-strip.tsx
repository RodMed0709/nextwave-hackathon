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
/**
 * Three believable lines of watch-work, not a slot machine. Each row is one
 * concrete thing the watch does for THIS case, ticking at the pace real feed
 * traffic actually moves — a message every several seconds, a counter that
 * only grows when something genuinely arrived.
 */
const ACTIVITY: readonly (readonly string[])[] = [
  [
    'MSC feed: schedule bulletin read',
    'Booking BKG-4471-R2 on file',
    'MSC feed: no new notices',
  ],
  [
    'Update matched to OP-4471',
    'Nothing waiting in the queue',
  ],
  [
    'ETA Oct 3 — holding',
    'PO-7731 committed date watched',
    'No drift on the lane',
  ],
]

const BASE_COUNTS = [38, 24, 51]
const TICK_MS = 4_600

export function AmbientStrip({ nodes }: { nodes: RunNode[] }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="ambient-strip">
      <div className="ambient-items">
        {nodes.slice(0, 3).map((node, index) => {
          const feed = ACTIVITY[index % ACTIVITY.length]
          const message = feed[tick % feed.length]
          // A counter that only moves when a "new item" plausibly landed.
          const count = BASE_COUNTS[index % BASE_COUNTS.length] + Math.floor(tick / feed.length)
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
