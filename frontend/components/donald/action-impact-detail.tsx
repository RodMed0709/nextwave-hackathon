import type { ActionImpact } from '@/data/action-impact'

type ActionImpactDetailProps = {
  impact: ActionImpact
}

export function ActionImpactDetail({ impact }: ActionImpactDetailProps) {
  if (impact.type === 'trace') {
    return (
      <div className="action-impact action-impact-trace">
        <span className="action-impact-label">OPERATIONAL TRACE</span>
        <p>{impact.messages[0]}</p>
      </div>
    )
  }

  const sources = Array.from(new Set(impact.metrics.map((metric) => metric.source).filter(Boolean)))

  return (
    <div className="action-impact action-impact-receipt">
      <span className="action-impact-label">{impact.strength === 'strong' ? 'INDUSTRY BENCHMARK' : 'CONTEXT BENCHMARK'}</span>
      <div className="impact-metrics">
        {impact.metrics.map((metric) => (
          <div className="impact-metric" key={`${metric.value}-${metric.label}`}>
            <b>{metric.value}</b>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
      {sources.length > 0 && <small>SOURCE · {sources.join(' / ')}</small>}
      {impact.note && <em>{impact.note}</em>}
    </div>
  )
}
