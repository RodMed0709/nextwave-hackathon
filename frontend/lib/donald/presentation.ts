import type { DonaldEvent, InterventionRecord, NodeSummary, RunArtifact, RunNode, RunState, RunSubtaskStatus } from './types'

export const NODE_STAGGER_MS = 120
export const EDGE_LAND_DELAY_MS = 340
const EDGE_DRAW_MS = 340

export type NodePresentation = {
  delayMs: number
  discovered: boolean
  /** Born because a person steered: the card the operator's instruction created. */
  steeredBorn: boolean
  batch: number
}

export type EdgePresentation = {
  delayMs: number
  batch: number
}

export type GraphPresentation = {
  nodes: Record<string, NodePresentation>
  edges: Record<string, EdgePresentation>
}

export type LiveNodeStatus = {
  key: string
  text: string
}

export type SubtaskPresentation = {
  icon: 'ring' | 'spinner' | 'check' | 'minus' | 'x'
  tone: 'muted' | 'emphasis' | 'failed'
  struck: boolean
}

export function shouldShowInstructionForm(optionCount: number, customInstructionRequested: boolean): boolean {
  return optionCount === 0 || customInstructionRequested
}

export function getLatestArtifact(artifacts: readonly RunArtifact[]): RunArtifact | null {
  return artifacts.at(-1) ?? null
}

export function getSubtaskPresentation(status: RunSubtaskStatus): SubtaskPresentation {
  switch (status) {
    case 'pending': return { icon: 'ring', tone: 'muted', struck: false }
    case 'running': return { icon: 'spinner', tone: 'emphasis', struck: false }
    case 'done': return { icon: 'check', tone: 'muted', struck: true }
    case 'skipped': return { icon: 'minus', tone: 'muted', struck: true }
    case 'failed': return { icon: 'x', tone: 'failed', struck: false }
    // Unreachable through the union, and deliberately handled anyway: without it
    // an unexpected status returned undefined, and FlowCard crashed reading
    // .tone off it. A status we do not know should look unstarted, not take the
    // card down with it.
    default: return { icon: 'ring', tone: 'muted', struck: false }
  }
}

export type DisplayMetric = {
  key: string
  label: string
  value: string
  severity: 1 | 2 | 3
}

export type ReplanNotice = {
  key: string
  revision: number
  reason: string
  triggeredBy: string | null
  evidenceIds: string[]
}

export type RecalculationNotice = {
  key: string
  kind: 'replan' | 'addition'
  reason: string | null
  evidenceIds: string[]
}

export function keepStillRemovedKeys(
  hiddenKeys: Set<string>,
  removedKeys: Iterable<string>,
): Set<string> {
  const removed = new Set(removedKeys)
  if ([...hiddenKeys].every((key) => removed.has(key))) return hiddenKeys
  return new Set([...hiddenKeys].filter((key) => removed.has(key)))
}

const STRUCTURAL_EVENT_TYPES = new Set([
  'node_added',
  'node_removed',
  'edge_added',
  'edge_removed',
])

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function titleFromKey(key: string): string {
  const cleaned = key
    .replace(/_usd$/i, '')
    .replace(/_days?$/i, '')
    .replaceAll('_', ' ')
    .trim()
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : 'Metric'
}

function metricSeverity(key: string): 1 | 2 | 3 {
  if (/(?:cost|price|amount|usd)/i.test(key)) return 3
  if (/(?:day|delay|duration|lead_time|eta)/i.test(key)) return 2
  return 1
}

function metricValue(key: string, value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && /(?:cost|price|amount|usd)/i.test(key)) {
    return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} USD`
  }
  if (typeof value === 'number' && /days?/i.test(key)) return `${value} ${value === 1 ? 'day' : 'days'}`
  return typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value
}

export function metricRows(metrics: NodeSummary['metrics']): DisplayMetric[] {
  return Object.entries(metrics)
    .map(([key, value]) => ({
      key,
      label: titleFromKey(key),
      value: metricValue(key, value),
      severity: metricSeverity(key),
    }))
    .sort((left, right) => right.severity - left.severity || left.label.localeCompare(right.label))
}

export function getPrimaryMetric(metrics: NodeSummary['metrics']): DisplayMetric | null {
  return metricRows(metrics)[0] ?? null
}

export function getRunRequest(run: RunState['run']): string {
  return stringValue(run.name) ?? stringValue(run.plan_summary) ?? run.key
}

export function getLatestReplan(events: readonly DonaldEvent[]): ReplanNotice | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.event_type !== 'run_updated') continue
    const revision = numberValue(event.payload.graph_revision)
    const reason = stringValue(event.payload.reason)
    if (revision === null || !reason) continue
    return {
      key: event.idempotency_key,
      revision,
      reason,
      triggeredBy: stringValue(event.payload.triggered_by),
      evidenceIds: Array.isArray(event.payload.evidence)
        ? event.payload.evidence.filter((value): value is string => typeof value === 'string')
        : [],
    }
  }
  return null
}

export function getLatestRecalculation(events: readonly DonaldEvent[]): RecalculationNotice | null {
  const replan = getLatestReplan(events)
  let workStarted = false
  let addition: DonaldEvent | null = null
  for (const event of events) {
    if (event.event_type === 'node_status_changed' && event.payload.status === 'in_progress') workStarted = true
    if (workStarted && event.event_type === 'node_added') addition = event
  }
  if (replan) {
    const replanIndex = events.findIndex((event) => event.idempotency_key === replan.key)
    const additionIndex = addition ? events.findIndex((event) => event.idempotency_key === addition.idempotency_key) : -1
    const operationalBoundary = additionIndex > replanIndex && events
      .slice(replanIndex + 1, additionIndex)
      .some((event) => !STRUCTURAL_EVENT_TYPES.has(event.event_type))
    if (!addition || !operationalBoundary) {
      return {
        key: replan.key,
        kind: 'replan',
        reason: replan.reason,
        evidenceIds: replan.evidenceIds,
      }
    }
  }
  return addition
    ? { key: addition.idempotency_key, kind: 'addition', reason: null, evidenceIds: [] }
    : null
}

/**
 * Every stop or steer raised against one step, newest first.
 *
 * This used to be rebuilt by scanning the event log for `operator_instruction_*`
 * events - a shape the server has never emitted. The real events are
 * intervention_requested / _delivered / _resolved, correlated by intervention
 * id, and the reducer now folds them into state.interventions as they arrive.
 * Reading that is both correct and cheaper than re-scanning the whole log for
 * every node on every render.
 */
export function getNodeInterventions(
  interventions: Record<string, InterventionRecord>,
  nodeKey: string,
): InterventionRecord[] {
  return Object.values(interventions)
    .filter((record) => record.node_key === nodeKey)
    .sort((left, right) => Date.parse(right.queued_at) - Date.parse(left.queued_at))
}

/** The one still waiting on the agent, if any. */
export function getPendingIntervention(
  interventions: Record<string, InterventionRecord>,
  nodeKey: string,
): InterventionRecord | null {
  return getNodeInterventions(interventions, nodeKey).find((record) => record.status !== 'resolved') ?? null
}

export function getPlanRevealDurationMs(event: DonaldEvent): number {
  if (event.event_type !== 'plan_declared') return 0
  const plan = recordValue(event.payload.plan)
  const steps = plan && Array.isArray(plan.steps) ? plan.steps.length : 0
  if (steps === 0) return 0
  return Math.max(0, steps - 1) * NODE_STAGGER_MS + EDGE_LAND_DELAY_MS + EDGE_DRAW_MS
}

export function getGraphPresentation(events: readonly DonaldEvent[]): GraphPresentation {
  const nodes: Record<string, NodePresentation> = {}
  const edges: Record<string, EdgePresentation> = {}
  let batch = 0
  let additionsInBatch = 0
  let insideStructuralBatch = false
  let workHasStarted = false
  // Tracks the window in which new nodes are the operator's doing: from the
  // moment a person steers, through the agent resolving it, until the burst of
  // graph changes that resolution produces has landed. Cards born inside the
  // window carry a distinct color, so "that one exists because I asked" is
  // visible at a glance.
  let steerPhase: 'idle' | 'requested' | 'resolved' = 'idle'

  for (const event of events) {
    const structural = STRUCTURAL_EVENT_TYPES.has(event.event_type)
    if (structural && !insideStructuralBatch) {
      batch += 1
      additionsInBatch = 0
    }
    if (!structural && insideStructuralBatch && steerPhase === 'resolved') {
      steerPhase = 'idle'
    }
    if (event.event_type === 'intervention_requested' && event.payload.origin === 'operator') {
      steerPhase = 'requested'
    }
    if (event.event_type === 'intervention_resolved' && steerPhase === 'requested') {
      steerPhase = 'resolved'
    }

    if (
      event.event_type === 'node_status_changed' &&
      event.payload.status === 'in_progress'
    ) {
      workHasStarted = true
    }

    if (event.event_type === 'node_added' && event.node_key) {
      nodes[event.node_key] = {
        delayMs: additionsInBatch * NODE_STAGGER_MS,
        discovered: workHasStarted,
        steeredBorn: steerPhase !== 'idle',
        batch,
      }
      additionsInBatch += 1
    }

    if (event.event_type === 'edge_added') {
      const edgeKey = stringValue(event.payload.edge_key)
      const sourceKey = stringValue(event.payload.source_node_key)
      const targetKey = stringValue(event.payload.target_node_key)
      if (edgeKey) {
        const endpointDelays = [sourceKey, targetKey]
          .flatMap((key) => key && nodes[key]?.batch === batch ? [nodes[key].delayMs] : [])
        edges[edgeKey] = {
          delayMs: Math.max(0, ...endpointDelays) + EDGE_LAND_DELAY_MS,
          batch,
        }
      }
    }

    insideStructuralBatch = structural
  }

  return { nodes, edges }
}

export function getVisiblyActiveNodeKey(
  nodes: Record<string, RunNode>,
  events: readonly DonaldEvent[],
): string | null {
  return getVisiblyActiveNodeKeys(nodes, events)[0] ?? null
}

export function getVisiblyActiveNodeKeys(
  nodes: Record<string, RunNode>,
  events: readonly DonaldEvent[],
): string[] {
  const activeKeys: string[] = []
  const seen = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event.event_type === 'node_status_changed' &&
      event.payload.status === 'in_progress' &&
      event.node_key &&
      nodes[event.node_key]?.status === 'in_progress' &&
      !nodes[event.node_key].removed &&
      !seen.has(event.node_key)
    ) {
      seen.add(event.node_key)
      activeKeys.push(event.node_key)
    }
  }

  const remaining = Object.values(nodes)
    .filter((node) => node.status === 'in_progress' && !node.removed)
    .sort((left, right) =>
      Date.parse(right.started_at ?? '') - Date.parse(left.started_at ?? '') ||
      (left.plan_order ?? Number.MAX_SAFE_INTEGER) - (right.plan_order ?? Number.MAX_SAFE_INTEGER),
    )
  for (const node of remaining) {
    if (seen.has(node.node_key)) continue
    seen.add(node.node_key)
    activeKeys.push(node.node_key)
  }
  return activeKeys
}

function fallbackStatus(node: RunNode, event: DonaldEvent): string {
  const actor = event.agent_label ?? node.agent_label ?? 'Donald'
  const progress = typeof event.payload.progress_percent === 'number'
    ? event.payload.progress_percent
    : 0
  const action = progress < 35 ? 'is starting' : progress < 75 ? 'is working on' : 'is finishing'
  return `${actor} ${action} ${node.label}`
}

export function getLatestNodeStatus(
  node: RunNode,
  events: readonly DonaldEvent[],
): LiveNodeStatus | null {
  if (node.status !== 'in_progress' || node.removed) return null

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.node_key !== node.node_key) continue
    if (
      event.event_type !== 'node_updated' &&
      event.event_type !== 'node_status_changed' &&
      event.event_type !== 'agent_message'
    ) continue

    const hasSubtasks = Array.isArray(event.payload.subtasks) && event.payload.subtasks.length > 0
    const detail = hasSubtasks ? null : stringValue(event.payload.detail)
    const text = stringValue(event.payload.status_message) ??
      stringValue(event.payload.message) ??
      stringValue(event.payload.headline) ??
      stringValue(event.payload.finding) ??
      detail ??
      fallbackStatus(node, event)
    return { key: event.idempotency_key, text }
  }

  return null
}


/**
 * What a person's hour is worth, for turning saved minutes into saved money.
 *
 * One number, set in one place and SHOWN on screen next to the figure it
 * produces. A savings claim whose arithmetic is hidden is a marketing number;
 * one that shows its rate is an argument the viewer can check and disagree with.
 */
export const LABOR_RATE_USD_PER_HOUR =
  Number(process.env.NEXT_PUBLIC_DONALD_LABOR_RATE_USD) || 45

export type AutomationSaving = {
  minutes: number
  humanTime: string
  money: string
  basis: string
}

function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function usd(amount: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)}`
}

/**
 * What this step saved by being done by an agent instead of a person.
 *
 * Returns null when the agent did not say. That is deliberate: a step with no
 * reported baseline shows nothing rather than a number we made up. Inventing one
 * here would be indistinguishable on screen from one the agent actually
 * measured, and the difference is the entire point.
 */
export function getAutomationSaving(node: RunNode): AutomationSaving | null {
  const minutes = node.manual_minutes
  if (typeof minutes !== 'number' || minutes <= 0) return null
  return {
    minutes,
    humanTime: humanMinutes(minutes),
    money: usd((minutes / 60) * LABOR_RATE_USD_PER_HOUR),
    basis: `${humanMinutes(minutes)} of manual work at ${usd(LABOR_RATE_USD_PER_HOUR)}/h`,
  }
}

/** The run's total, over the steps that reported a baseline. */
export function getRunSavings(nodes: Record<string, RunNode>): AutomationSaving | null {
  const minutes = Object.values(nodes)
    .filter((node) => !node.removed && node.status === 'succeeded')
    .reduce((total, node) => total + (node.manual_minutes ?? 0), 0)
  if (minutes <= 0) return null
  return {
    minutes,
    humanTime: humanMinutes(minutes),
    money: usd((minutes / 60) * LABOR_RATE_USD_PER_HOUR),
    basis: `${humanMinutes(minutes)} of manual work at ${usd(LABOR_RATE_USD_PER_HOUR)}/h`,
  }
}

/** A step the operator can still influence. A finished step is a fact, not a lever. */
export function canIntervene(node: RunNode): boolean {
  if (node.removed) return false
  return node.status === 'not_started' ||
    node.status === 'in_progress' ||
    node.status.startsWith('blocked_on_')
}
