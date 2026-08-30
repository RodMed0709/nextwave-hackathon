import type { DonaldActionId } from './action-presentation'

export type ImpactProvenance = 'measured' | 'benchmark-based' | 'internal-estimate'

export type ImpactMetric = {
  value: string
  label: string
  source?: string
}

export type ActionImpact =
  | {
      type: 'receipt'
      strength: 'strong' | 'context'
      metrics: ImpactMetric[]
      note?: string
    }
  | {
      type: 'trace'
      messages: string[]
    }

export const ACTION_IMPACTS: Record<DonaldActionId, ActionImpact> = {
  ingest: {
    type: 'trace',
    messages: [
      'Reading attached carrier, broker, or supplier documents.',
      'New source captured for the operation record.',
      'Ingesting the latest operational notice.',
    ],
  },
  identify: {
    type: 'trace',
    messages: [
      'Matched this input to an existing operation.',
      'Resolved the shipment, vessel, client, or supplier reference.',
      'Unrecognized references stay visible for manual entity matching.',
    ],
  },
  extract: {
    type: 'receipt',
    strength: 'strong',
    metrics: [
      { value: '~15 min', label: 'average manual data entry + verification per document', source: 'Resolve / APQC' },
      { value: '39%', label: 'manually processed invoices containing at least one error', source: 'Resolve' },
      { value: '$15-40', label: 'manual processing cost per invoice', source: 'Resolve' },
    ],
  },
  reconcile: {
    type: 'receipt',
    strength: 'strong',
    metrics: [
      { value: '10-15 min', label: 'manual cross-check per shipment', source: 'Tier2 Systems' },
      { value: '60%+', label: 'invoice discrepancies tracing back to manual data entry', source: 'APQC via Tier2' },
      { value: '$1,000-3,000', label: 'combined fees when customs catches a discrepancy', source: 'Tier2 Systems' },
    ],
  },
  monitor: {
    type: 'trace',
    messages: [
      'Watching active operations against the expected range.',
      'Tracking free-time, ETA, and schedule clocks.',
      'Next check remains part of the ambient watch.',
    ],
  },
  detect: {
    type: 'receipt',
    strength: 'strong',
    metrics: [
      { value: '80%', label: 'shippers lacking full visibility across all regions and modes', source: 'project44' },
      { value: '~15 min', label: 'manual effort to assemble one delayed shipment across systems', source: 'supply chain visibility research' },
      { value: '94%', label: 'companies reporting revenue impact from disruptions', source: 'industry survey' },
    ],
  },
  explain: {
    type: 'trace',
    messages: [
      'Root cause and evidence are presented as operational context.',
      'Evidence sources are cross-checked before a cause is shown.',
      'Patterns are noted without turning context into ROI.',
    ],
  },
  impact: {
    type: 'trace',
    messages: [
      'Consequences are modeled against available shipment context.',
      'Exposure calculations stay tied to actual run metrics.',
      'No material impact remains a valid operational result.',
    ],
  },
  predict: {
    type: 'receipt',
    strength: 'context',
    metrics: [
      { value: '+38%', label: 'year-over-year rise in disruption events', source: 'Resilinc' },
      { value: '~90%', label: 'Perfect Order Index industry median', source: 'MetricHQ / APQC' },
    ],
    note: 'Prediction receipt values require measured lead-time from the run.',
  },
  plan: {
    type: 'receipt',
    strength: 'context',
    metrics: [
      { value: '30-60%', label: 'reduction in demurrage & detention exposure from proactive response strategies', source: 'shippingrates.org' },
    ],
    note: 'Planning value requires real exposure parameters or an explicitly reported internal estimate.',
  },
  decide: {
    type: 'trace',
    messages: [
      'Policy gates and human decisions are recorded without artificial ROI.',
      'Ambiguous calls route to a person rather than guessing.',
      'Approved decisions remain operational evidence, not savings math.',
    ],
  },
  act: {
    type: 'receipt',
    strength: 'strong',
    metrics: [
      { value: '$22B/yr', label: 'global demurrage & detention spend', source: 'shippingrates.org' },
      { value: '$100-150/day', label: 'typical average D&D exposure per container', source: 'shippingrates.org' },
      { value: '3-7 days', label: 'typical free-time window before charges begin', source: 'shippingrates.org' },
      { value: '~$138/day', label: 'North America average', source: 'shippingrates.org' },
    ],
  },
}

export function actionImpactFor(actionId: DonaldActionId): ActionImpact {
  return ACTION_IMPACTS[actionId]
}
