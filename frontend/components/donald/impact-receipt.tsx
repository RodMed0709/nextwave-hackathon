'use client'

import {
  formatReceiptMinutes,
  formatReceiptUsd,
  type ImpactContribution,
  type StageImpactReceipt,
} from '@/lib/donald/impact-receipt'

function ContributionLine({ contribution }: { contribution: ImpactContribution }) {
  const value = contribution.timeSavedMinutes
    ? formatReceiptMinutes(contribution.timeSavedMinutes)
    : contribution.valueProtectedUsd
      ? formatReceiptUsd(contribution.valueProtectedUsd)
      : contribution.leadTimeHours
        ? `${contribution.leadTimeHours}h lead time`
        : null

  if (!value) return null
  return (
    <li>
      <span>{contribution.label}</span>
      <strong>{value}</strong>
      <em>{contribution.provenance}</em>
    </li>
  )
}

function ContextBlock({ receipt, kind }: { receipt: StageImpactReceipt; kind: 'time' | 'value' }) {
  const context = kind === 'value'
    ? receipt.contexts.find((candidate) => /D&D|exposure|container/i.test(candidate.text)) ?? receipt.contexts[1] ?? receipt.contexts[0]
    : receipt.contexts.find((candidate) => /minute|visibility/i.test(candidate.text)) ?? receipt.contexts[0]

  if (!context) return null
  return (
    <div className="impact-receipt-context">
      <span>Industry Context</span>
      <p>{context.text}</p>
      <small>{context.source}</small>
    </div>
  )
}

export function ImpactReceipt({ receipt }: { receipt: StageImpactReceipt }) {
  const hasBreakdown = receipt.contributions.length > 0

  return (
    <section className="impact-receipt" aria-label="Impact receipt">
      <div className="impact-receipt-heading">Impact Receipt</div>
      <div className="impact-receipt-grid">
        <div className="impact-receipt-card time-impact">
          <span>Est. Time Saved</span>
          <strong>{formatReceiptMinutes(receipt.timeSavedMinutes)}</strong>
          <small>{receipt.timeNote}</small>
          <ContextBlock receipt={receipt} kind="time" />
        </div>
        <div className="impact-receipt-card value-impact">
          <span>Est. Value Protected</span>
          <strong>{receipt.valueProtectedUsd === null && receipt.stageId === 'above' ? 'Visibility layer' : formatReceiptUsd(receipt.valueProtectedUsd)}</strong>
          <small>{receipt.valueNote}</small>
          <ContextBlock receipt={receipt} kind="value" />
        </div>
      </div>
      {hasBreakdown && (
        <details className="impact-receipt-breakdown">
          <summary>View breakdown</summary>
          <ul>
            {receipt.contributions.map((contribution) => (
              <ContributionLine
                contribution={contribution}
                key={`${contribution.nodeKey}-${contribution.kind}`}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
