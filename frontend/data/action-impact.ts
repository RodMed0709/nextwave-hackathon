import type { CapabilityType } from '@/components/donald-pet/types'

export type ImpactMetric = {
  value: string
  label: string
  source?: string
}

export type RuntimeCommentKey = 'waiting' | 'running' | 'moving' | 'complete' | 'decisionRequired' | 'failed' | 'sleeping'
export type PetCommentCategory = 'money' | 'operational'
export type PetComment = {
  text: string
  category: PetCommentCategory
}

type ActionImpactBase = {
  comment?: PetComment
  comments?: Partial<Record<RuntimeCommentKey, PetComment>>
}

export type ActionImpact =
  | (ActionImpactBase & {
      type: 'receipt'
      strength: 'strong' | 'context'
      headline?: string
      metrics: ImpactMetric[]
      note?: string
    })
  | (ActionImpactBase & {
      type: 'trace'
      messages: string[]
    })

type PetCommentContext = {
  operationalExposure?: string
  isMoving?: boolean
}

export const actionImpact: Record<CapabilityType, ActionImpact> = {
  INGEST: {
    type: 'trace',
    comment: { text: "I'm reading the booking confirmation from the carrier email.", category: 'operational' },
    messages: [
      'Reading Booking Confirmation.pdf — attached to carrier email.',
      'New source: carrier email · 1 attachment · 340 KB.',
      'Ingesting Arrival Notice from customs broker.',
    ],
  },
  IDENTIFY: {
    type: 'trace',
    comment: { text: 'I matched this document to OP-2291, so no duplicate record is needed.', category: 'operational' },
    messages: [
      'Resolved to Operation OP-2291 · Vessel MSC ARIA · Client Muebles del Sur.',
      'Matched this document to an existing operation — no new record needed.',
      'Unrecognized supplier reference — flagging for manual entity match.',
    ],
  },
  EXTRACT: {
    type: 'receipt',
    strength: 'strong',
    comment: { text: 'Manual entry from this document usually takes ~15 min.', category: 'operational' },
    metrics: [
      { value: '~15 min', label: 'average manual data entry + verification per document', source: 'Resolve / APQC' },
      { value: '39%', label: 'manually processed invoices containing at least one error', source: 'Resolve' },
      { value: '$15-40', label: 'manual processing cost per invoice', source: 'Resolve' },
    ],
  },
  RECONCILE: {
    type: 'receipt',
    strength: 'strong',
    comment: { text: 'Manual cross-checks average 10-15 min per shipment.', category: 'operational' },
    metrics: [
      { value: '10-15 min', label: 'manual cross-check per shipment', source: 'Tier2 Systems' },
      { value: '60%+', label: 'invoice discrepancies tracing back to manual data entry', source: 'APQC via Tier2' },
      { value: '$1,000-3,000', label: 'combined fees when a discrepancy is caught at customs, typically with a 5-7 day hold', source: 'Tier2 Systems' },
    ],
  },
  MONITOR: {
    type: 'trace',
    comment: { text: "I'm monitoring the shipment. No additional exceptions detected.", category: 'operational' },
    messages: [
      'Watching 12 active operations. Nothing outside expected range.',
      'Free-time countdown: 5 days remaining on OP-2291.',
      'Next scheduled check: vessel position, in 4 hours.',
    ],
  },
  PREDICT: {
    type: 'receipt',
    strength: 'context',
    comment: { text: 'ETA risk is increasing. Current forecast indicates a 9-day delay.', category: 'operational' },
    metrics: [
      { value: '+38%', label: 'year-over-year rise in disruption events', source: 'Resilinc' },
      { value: '~90%', label: 'Perfect Order Index industry median', source: 'MetricHQ / APQC' },
    ],
    note: 'Context benchmark only; not a Donald forecast-speed claim.',
  },
  DETECT: {
    type: 'receipt',
    strength: 'strong',
    comment: { text: 'I found an unexpected Busan transshipment.', category: 'operational' },
    metrics: [
      { value: '80%', label: 'shippers lacking full visibility across all regions and modes', source: 'project44' },
      { value: '~15 min', label: 'manual effort to assemble one delayed shipment across ERP / MES / TMS', source: 'supply chain visibility research' },
      { value: '94%', label: 'companies reporting revenue impact from disruptions', source: 'industry survey' },
    ],
  },
  EXPLAIN: {
    type: 'trace',
    comment: { text: 'The delay comes from an unplanned Colombo transshipment, not origin.', category: 'operational' },
    messages: [
      'Root cause: unplanned Colombo transshipment, not a carrier delay at origin.',
      'Evidence trail: 3 sources cross-checked — carrier notice, AIS position, original booking.',
      'Not a new pattern — same carrier flagged a similar reroute on this lane in July.',
    ],
  },
  IMPACT: {
    type: 'trace',
    comment: { text: 'This delay creates $18,400 in operational exposure.', category: 'money' },
    messages: [
      "Consequence modeled against this client's actual contract terms, not a general estimate.",
      'Calculating exposure across 2 containers, 1 client, 1 free-time clock.',
      'No material impact — within normal transit variance, no escalation needed.',
    ],
  },
  PLAN: {
    type: 'receipt',
    strength: 'context',
    comment: { text: 'I ranked three recovery options. The alternate route has the best tradeoff.', category: 'operational' },
    metrics: [
      { value: '30-60%', label: 'reduction in demurrage & detention exposure from consistently proactive response strategies', source: 'shippingrates.org' },
    ],
    note: 'Context benchmark only; no manual planning-time benchmark is shown.',
  },
  DECIDE: {
    type: 'trace',
    comment: { text: 'I need your approval before I continue.', category: 'operational' },
    comments: {
      decisionRequired: { text: "I can't auto-approve this one. The exposure is {{operationalExposure}}. I need your decision.", category: 'money' },
      running: { text: 'I am checking the recommendation against the approval policy.', category: 'operational' },
      complete: { text: 'Decision captured. I can resume the same run.', category: 'operational' },
    },
    messages: [
      'Within policy — proceeding without a human gate.',
      'Outside the auto-approval threshold — holding for your decision.',
      'Ambiguous call — routing to you rather than guessing.',
    ],
  },
  ACT: {
    type: 'receipt',
    strength: 'strong',
    comment: { text: 'Reroute confirmed. Updated ETA is Sep 22.', category: 'operational' },
    metrics: [
      { value: '$22B/yr', label: 'global demurrage & detention spend', source: 'shippingrates.org' },
      { value: '$100-150/day', label: 'typical average D&D exposure per container', source: 'shippingrates.org' },
      { value: '3-7 days', label: 'typical free-time window before charges begin', source: 'shippingrates.org' },
    ],
  },
}

export function getActionImpact(capability: CapabilityType) {
  return actionImpact[capability]
}

export function getPetComment(capability: CapabilityType, status: string, context: PetCommentContext = {}) {
  const impact = getActionImpact(capability)
  const key: RuntimeCommentKey =
    context.isMoving ? 'moving' :
    status === 'NEEDS HUMAN' ? 'decisionRequired' :
    status === 'RUNNING' ? 'running' :
    status === 'DONE' ? 'complete' :
    status === 'FAILED' ? 'failed' :
    status === 'SKIPPED' || status === 'BLOCKED' ? 'sleeping' :
    'waiting'

  const comment = impact.comments?.[key] ?? impact.comment ?? {
    text: impact.type === 'trace' ? impact.messages[0] : impact.metrics[0]?.label,
    category: 'operational' as const,
  }
  return {
    ...comment,
    text: comment.text.replace('{{operationalExposure}}', context.operationalExposure ?? 'the current exposure'),
  }
}
