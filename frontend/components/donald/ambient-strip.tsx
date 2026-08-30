'use client'

import type { RunNode } from '@/lib/donald/types'

/**
 * The Watch as a compact loop, not a graph.
 *
 * These three tasks never finish — rendering them as cards with DONE badges
 * told the wrong story and spent a screenful of vertical space on it. A slim
 * strip with a perpetually spinning loop per task says the true thing: this
 * runs forever, and when it catches something the case opens below.
 */
export function AmbientStrip({ nodes, caseStudy }: { nodes: RunNode[]; caseStudy: string | null }) {
  return (
    <div className="ambient-strip">
      <div className="ambient-items">
        {nodes.map((node) => (
          <div className="ambient-item" key={node.node_key} title={node.output_summary?.detail ?? undefined}>
            <span className="ambient-loop" aria-hidden="true" />
            <div className="ambient-copy">
              <strong>{node.label}</strong>
              {node.output_summary?.detail && <small>{node.output_summary.detail}</small>}
            </div>
          </div>
        ))}
      </div>
      {caseStudy && <p className="ambient-proof">{caseStudy}</p>}
    </div>
  )
}
