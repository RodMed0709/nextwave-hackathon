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

/** One human sentence, not a benchmark citation. */
function timePhrase(minutes: number | null): string {
  if (!minutes || minutes <= 0) return 'Nothing to count yet'
  if (minutes >= 60) {
    const hours = minutes / 60
    const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10
    return `${rounded} hours of manual work Donald just did for you`
  }
  return `${Math.round(minutes)} minutes of manual work Donald just did for you`
}

export function ImpactReceipt({ receipt, manualMinutes = 0 }: { receipt: StageImpactReceipt; manualMinutes?: number }) {
  const hasBreakdown = receipt.contributions.length > 0
  // The header sums manual_minutes; showing a different benchmark total here
  // made both numbers look invented. One truth, everywhere.
  const timeSaved = manualMinutes > 0 ? manualMinutes : receipt.timeSavedMinutes

  return (
    <section className="impact-receipt" aria-label="Impact receipt">
      <div className="impact-receipt-heading">Impact Receipt</div>
      <div className="impact-receipt-grid">
        <div className="impact-receipt-card time-impact">
          <span>Manual Work Replaced</span>
          <strong>{formatReceiptMinutes(timeSaved)}</strong>
          <p className="impact-receipt-line">{timePhrase(timeSaved)}</p>
        </div>
        <div className="impact-receipt-card value-impact">
          <span>Value Protected</span>
          <strong>{formatReceiptUsd(receipt.valueProtectedUsd)}</strong>
          <p className="impact-receipt-line">
            {receipt.valueProtectedUsd
              ? 'Exposure avoided — 3 containers × 10 days × $138/day D&D benchmark'
              : 'No money at risk on this stage'}
          </p>
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
