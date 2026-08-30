import { actionImpactFor, type ImpactProvenance } from './action-impact'
import { donaldActionIdForNode, type DonaldActionId } from './action-presentation'
import type { OperationalStageId } from './operational-stages'
import type { RunNode } from './types'

export type ReceiptContributionKind = 'time' | 'value' | 'lead-time'

export type ImpactContribution = {
  nodeKey: string
  label: string
  actionId: DonaldActionId
  kind: ReceiptContributionKind
  timeSavedMinutes?: number
  valueProtectedUsd?: number
  leadTimeHours?: number
  provenance: ImpactProvenance
  explanation: string
}

export type ImpactReceiptContext = {
  text: string
  source: string
}

export type StageImpactReceipt = {
  stageId: OperationalStageId
  timeSavedMinutes: number | null
  valueProtectedUsd: number | null
  quantifiedJobs: number
  valueProvenance: ImpactProvenance | null
  contributions: ImpactContribution[]
  contexts: ImpactReceiptContext[]
  timeNote: string
  valueNote: string
}

const TIME_BENCHMARK_MINUTES: Partial<Record<DonaldActionId, number>> = {
  detect: 15,
  extract: 15,
  reconcile: 10,
}

const TRACE_ONLY_ACTIONS = new Set<DonaldActionId>(['ingest', 'identify', 'monitor', 'explain', 'impact', 'decide'])
const NORTH_AMERICA_DD_RATE_USD_PER_DAY = 138

function numberMetric(node: RunNode, keys: string[]): number | null {
  const metrics = node.output_summary?.metrics ?? {}
  for (const key of keys) {
    const value = metrics[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function actionIdForNode(node: RunNode): DonaldActionId | null {
  return donaldActionIdForNode({
    nodeKey: node.node_key,
    label: node.label,
    nodeType: node.node_type,
    toolName: node.tool_name,
    headline: node.output_summary?.headline,
    detail: node.output_summary?.detail,
  })
}

function valueContributionFor(node: RunNode, actionId: DonaldActionId): ImpactContribution | null {
  const directValue = numberMetric(node, [
    'value_protected_usd',
    'exposure_avoided_usd',
    'demurrage_avoided_usd',
    'detention_avoided_usd',
    'operational_cost_protected_usd',
  ])
  if (directValue && directValue > 0 && (actionId === 'act' || actionId === 'plan')) {
    return {
      nodeKey: node.node_key,
      label: node.label,
      actionId,
      kind: 'value',
      valueProtectedUsd: directValue,
      provenance: actionId === 'plan' ? 'internal-estimate' : 'measured',
      explanation: `${node.label}: $${Math.round(directValue).toLocaleString('en-US')} from shipment-specific run metrics`,
    }
  }

  if (actionId !== 'act') return null

  const containers = numberMetric(node, ['containers_affected', 'affected_containers', 'container_count'])
  const days = numberMetric(node, ['exposure_days', 'billable_days', 'demurrage_days', 'detention_days'])
  if (!containers || !days || containers <= 0 || days <= 0) return null

  const value = containers * days * NORTH_AMERICA_DD_RATE_USD_PER_DAY
  return {
    nodeKey: node.node_key,
    label: node.label,
    actionId,
    kind: 'value',
    valueProtectedUsd: value,
    provenance: 'benchmark-based',
    explanation: `${containers} containers x ${days} days x $${NORTH_AMERICA_DD_RATE_USD_PER_DAY}/day North America D&D benchmark`,
  }
}

function contributionsForNode(node: RunNode): ImpactContribution[] {
  if (node.removed || node.status !== 'succeeded') return []
  const actionId = actionIdForNode(node)
  if (!actionId || TRACE_ONLY_ACTIONS.has(actionId)) return []

  const impact = actionImpactFor(actionId)
  if (impact.type !== 'receipt') return []

  const contributions: ImpactContribution[] = []
  const minutes = TIME_BENCHMARK_MINUTES[actionId]
  if (minutes) {
    contributions.push({
      nodeKey: node.node_key,
      label: node.label,
      actionId,
      kind: 'time',
      timeSavedMinutes: minutes,
      provenance: 'benchmark-based',
      explanation: `${node.label}: ${minutes} min ${actionId === 'reconcile' ? 'conservative manual cross-check benchmark' : 'manual-work benchmark'}`,
    })
  }

  const leadTimeHours = numberMetric(node, ['lead_time_hours', 'flagged_hours_before_notice', 'hours_before_carrier_notice'])
  if (actionId === 'predict' && leadTimeHours && leadTimeHours > 0) {
    contributions.push({
      nodeKey: node.node_key,
      label: node.label,
      actionId,
      kind: 'lead-time',
      leadTimeHours,
      provenance: 'measured',
      explanation: `${node.label}: flagged ${leadTimeHours}h before the comparison event`,
    })
  }

  const valueContribution = valueContributionFor(node, actionId)
  if (valueContribution) contributions.push(valueContribution)
  return contributions
}

function contextsFor(stageId: OperationalStageId, nodes: RunNode[]): ImpactReceiptContext[] {
  if (stageId === 'above') {
    return [
      { text: '80% of shippers report lacking full visibility across all regions and modes.', source: 'project44' },
      { text: '57% cite insufficient visibility as their biggest supply-chain challenge.', source: 'General context' },
    ]
  }

  const actionIds = new Set(nodes.flatMap((node) => {
    const actionId = actionIdForNode(node)
    return actionId ? [actionId] : []
  }))
  const candidates: [DonaldActionId, ImpactReceiptContext][] = [
    ['act', { text: 'Per-container D&D exposure averages roughly $100-150/day globally; North America averages about $138/day.', source: 'shippingrates.org' }],
    ['plan', { text: 'Proactive D&D strategies are associated with roughly 30-60% exposure reduction.', source: 'shippingrates.org' }],
    ['reconcile', { text: 'Manual shipment cross-checks average 10-15 minutes.', source: 'Tier2 Systems' }],
    ['extract', { text: 'Manual data entry and verification averages about 15 minutes per document.', source: 'Resolve / APQC' }],
    ['detect', { text: 'Assembling one delayed shipment picture can take about 15 minutes manually.', source: 'supply chain visibility research' }],
  ]
  return candidates
    .filter(([actionId]) => actionIds.has(actionId))
    .map(([, context]) => context)
    .slice(0, 2)
}

function formatJobs(count: number): string {
  return count === 1 ? '1 quantified job' : `${count} quantified jobs`
}

function strongestProvenance(contributions: ImpactContribution[]): ImpactProvenance | null {
  if (contributions.some((contribution) => contribution.provenance === 'measured')) return 'measured'
  if (contributions.some((contribution) => contribution.provenance === 'benchmark-based')) return 'benchmark-based'
  if (contributions.some((contribution) => contribution.provenance === 'internal-estimate')) return 'internal-estimate'
  return null
}

export function formatReceiptMinutes(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return '-'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatReceiptUsd(amount: number | null): string {
  if (amount === null || amount <= 0) return '-'
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

export function getStageImpactReceipt(stageId: OperationalStageId, nodes: RunNode[]): StageImpactReceipt {
  const contributions = nodes.flatMap(contributionsForNode)
  const timeContributions = contributions.filter((contribution) => contribution.timeSavedMinutes)
  const valueContributions = contributions.filter((contribution) => contribution.valueProtectedUsd)
  const timeSavedMinutes = timeContributions.length > 0
    ? timeContributions.reduce((total, contribution) => total + (contribution.timeSavedMinutes ?? 0), 0)
    : null
  const valueProtectedUsd = valueContributions.length > 0
    ? valueContributions.reduce((total, contribution) => total + (contribution.valueProtectedUsd ?? 0), 0)
    : null
  const quantifiedNodeKeys = new Set(contributions
    .filter((contribution) => contribution.timeSavedMinutes || contribution.valueProtectedUsd)
    .map((contribution) => contribution.nodeKey))

  if (stageId === 'above') {
    return {
      stageId,
      timeSavedMinutes: null,
      valueProtectedUsd: null,
      quantifiedJobs: 0,
      valueProvenance: null,
      contributions,
      contexts: contextsFor(stageId, nodes),
      timeNote: 'Not yet quantified',
      valueNote: 'Visibility layer',
    }
  }

  return {
    stageId,
    timeSavedMinutes,
    valueProtectedUsd,
    quantifiedJobs: quantifiedNodeKeys.size,
    valueProvenance: strongestProvenance(valueContributions),
    contributions,
    contexts: contextsFor(stageId, nodes),
    timeNote: timeSavedMinutes === null ? 'No completed quantified jobs' : formatJobs(quantifiedNodeKeys.size),
    valueNote: valueProtectedUsd === null ? 'Needs shipment exposure' : (strongestProvenance(valueContributions) ?? 'measured'),
  }
}
