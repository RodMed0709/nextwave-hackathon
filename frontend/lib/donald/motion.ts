import { getVisiblyActiveNodeKey } from './presentation'
import type {
  DonaldEvent,
  RobotActivityKind,
  RobotActivityObject,
  RobotActivityPhase,
  RobotCurrencyMetricCue,
  RunEdge,
  RunNode,
} from './types'

export type RobotMotionCue = {
  key: string
  targetNodeKey: string | null
  previousNodeKey: string | null
  activity: RobotActivityKind
  phase: RobotActivityPhase
  object: RobotActivityObject | null
  copy: string | null
  metric: RobotCurrencyMetricCue | null
  tone: 'active' | 'waiting' | 'success' | 'failure'
}

export type RobotTransition = {
  kind: 'place' | 'travel' | 'resume' | 'fade' | 'complete'
  sourceNodeKey: string | null
  targetNodeKey: string | null
  edgeKey: string | null
}

export type RobotMotion = {
  cue: RobotMotionCue
  transition: RobotTransition
}

export type DeriveRobotMotionInput = {
  event: DonaldEvent
  events: readonly DonaldEvent[]
  nodes: Record<string, RunNode>
  edges: Record<string, RunEdge>
  previousNodeKey: string | null
}

export type RobotMotionQueue = {
  inFlight: RobotMotionCue | null
  pending: RobotMotionCue | null
  lastSequence: number
}

export type MotionPoint = { x: number; y: number }
export type MotionNodePosition = { x: number; y: number; depth?: number }
export type MotionNodeSize = { width: number; height: number }
export type NodeTravelAnchors = { source: MotionPoint; target: MotionPoint }

const ACTIVITY_KINDS = new Set<RobotActivityKind>([
  'document.read',
  'message.send',
  'message.receive',
  'data.check',
  'calculate',
  'submit',
])

const ACTIVITY_PHASES = new Set<RobotActivityPhase>(['started', 'progress', 'completed'])
const OBJECT_KINDS = new Set<RobotActivityObject['kind']>(['document', 'email', 'record'])
const RECOVERABLE_STATUSES = new Set([
  'blocked_on_user_decision',
  'blocked_on_missing_data',
  'blocked_on_provider_outage',
])

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseActivity(value: unknown): {
  activity: RobotActivityKind
  phase: RobotActivityPhase | null
  object: RobotActivityObject | null
  copy: string | null
} {
  const activity = recordValue(value)
  if (!activity || !ACTIVITY_KINDS.has(activity.kind as RobotActivityKind)) {
    return { activity: 'work.generic', phase: null, object: null, copy: null }
  }

  const object = recordValue(activity.object)
  const objectKind = object?.kind
  const objectLabel = stringValue(object?.label)
  return {
    activity: activity.kind as RobotActivityKind,
    phase: ACTIVITY_PHASES.has(activity.phase as RobotActivityPhase)
      ? activity.phase as RobotActivityPhase
      : null,
    object: object && OBJECT_KINDS.has(objectKind as RobotActivityObject['kind']) && objectLabel
      ? { kind: objectKind as RobotActivityObject['kind'], label: objectLabel }
      : null,
    copy: stringValue(activity.copy),
  }
}

function parseMetric(value: unknown): RobotCurrencyMetricCue | null {
  const metric = recordValue(value)
  const label = stringValue(metric?.label)
  if (
    !metric ||
    metric.kind !== 'currency' ||
    typeof metric.value !== 'number' ||
    !Number.isFinite(metric.value) ||
    typeof metric.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(metric.currency) ||
    !label
  ) return null

  return {
    kind: 'currency',
    value: metric.value,
    currency: metric.currency,
    label,
  }
}

function toneFor(event: DonaldEvent): RobotMotionCue['tone'] {
  const status = event.payload.status
  if (event.event_type === 'run_finished' || status === 'finished' || status === 'succeeded') {
    return 'success'
  }
  if (event.event_type === 'run_failed' || status === 'failed') return 'failure'
  if (typeof status === 'string' && RECOVERABLE_STATUSES.has(status)) return 'waiting'
  return 'active'
}

function phaseFor(
  event: DonaldEvent,
  explicitPhase: RobotActivityPhase | null,
  tone: RobotMotionCue['tone'],
): RobotActivityPhase {
  if (explicitPhase) return explicitPhase
  if (tone === 'success' || tone === 'failure') return 'completed'
  if (event.event_type === 'node_updated') return 'progress'
  return 'started'
}

function targetFor(input: DeriveRobotMotionInput): string | null {
  if (input.event.event_type === 'run_finished' || input.event.event_type === 'run_failed') {
    return input.previousNodeKey
  }

  const eventNode = input.event.node_key ? input.nodes[input.event.node_key] : null
  const isNodeScopedMotion = input.event.event_type === 'node_status_changed' ||
    recordValue(input.event.payload.activity) !== null
  if (eventNode && !eventNode.removed && isNodeScopedMotion) return eventNode.node_key

  const visiblyActive = getVisiblyActiveNodeKey(input.nodes, input.events)
  if (visiblyActive) return visiblyActive
  if (eventNode && !eventNode.removed) return eventNode.node_key
  return input.previousNodeKey
}

function directEdge(
  sourceNodeKey: string,
  targetNodeKey: string,
  edges: Record<string, RunEdge>,
): RunEdge | null {
  return Object.values(edges)
    .filter((edge) =>
      isTraversableEdge(edge) &&
      edge.source_node_key === sourceNodeKey &&
      edge.target_node_key === targetNodeKey,
    )
    .sort((left, right) => left.edge_key.localeCompare(right.edge_key))[0] ?? null
}

function isTraversableEdge(edge: RunEdge): boolean {
  return edge.status !== 'removed' && edge.status !== 'skipped'
}

function isSameNodeResume(event: DonaldEvent, events: readonly DonaldEvent[]): boolean {
  if (
    event.event_type !== 'node_status_changed' ||
    event.payload.status !== 'in_progress' ||
    event.node_key === null
  ) return false

  const previousStatus = events
    .filter((candidate) =>
      candidate.sequence < event.sequence &&
      candidate.node_key === event.node_key &&
      candidate.event_type === 'node_status_changed',
    )
    .sort((left, right) => right.sequence - left.sequence)[0]?.payload.status
  return typeof previousStatus === 'string' && RECOVERABLE_STATUSES.has(previousStatus)
}

function transitionFor(
  input: DeriveRobotMotionInput,
  targetNodeKey: string | null,
): RobotTransition {
  if (input.event.event_type === 'run_finished') {
    return {
      kind: 'complete',
      sourceNodeKey: input.previousNodeKey,
      targetNodeKey,
      edgeKey: null,
    }
  }
  if (!input.previousNodeKey) {
    return { kind: 'place', sourceNodeKey: null, targetNodeKey, edgeKey: null }
  }
  if (input.previousNodeKey === targetNodeKey) {
    return {
      kind: isSameNodeResume(input.event, input.events) ? 'resume' : 'place',
      sourceNodeKey: input.previousNodeKey,
      targetNodeKey,
      edgeKey: null,
    }
  }
  if (!targetNodeKey) {
    return {
      kind: 'fade',
      sourceNodeKey: input.previousNodeKey,
      targetNodeKey: null,
      edgeKey: null,
    }
  }

  const edge = directEdge(input.previousNodeKey, targetNodeKey, input.edges)
  return edge
    ? {
        kind: 'travel',
        sourceNodeKey: input.previousNodeKey,
        targetNodeKey,
        edgeKey: edge.edge_key,
      }
    : {
        kind: 'fade',
        sourceNodeKey: input.previousNodeKey,
        targetNodeKey,
        edgeKey: null,
      }
}

export function deriveRobotMotion(input: DeriveRobotMotionInput): RobotMotion {
  const parsedActivity = parseActivity(input.event.payload.activity)
  const tone = toneFor(input.event)
  const targetNodeKey = targetFor(input)
  return {
    cue: {
      key: input.event.idempotency_key,
      targetNodeKey,
      previousNodeKey: input.previousNodeKey,
      activity: parsedActivity.activity,
      phase: phaseFor(input.event, parsedActivity.phase, tone),
      object: parsedActivity.object,
      copy: parsedActivity.copy,
      metric: parseMetric(input.event.payload.metric),
      tone,
    },
    transition: transitionFor(input, targetNodeKey),
  }
}

export function selectJoinPredecessor(
  targetNodeKey: string,
  edges: Record<string, RunEdge>,
  events: readonly DonaldEvent[],
): string | null {
  const predecessorKeys = [...new Set(Object.values(edges)
    .filter((edge) => isTraversableEdge(edge) && edge.target_node_key === targetNodeKey)
    .map((edge) => edge.source_node_key))]

  return predecessorKeys
    .map((nodeKey) => ({
      nodeKey,
      sequence: events.reduce((latest, event) =>
        event.node_key === nodeKey ? Math.max(latest, event.sequence) : latest, -1),
    }))
    .sort((left, right) => right.sequence - left.sequence || left.nodeKey.localeCompare(right.nodeKey))[0]
    ?.nodeKey ?? null
}

export function createRobotMotionQueue(lastSequence = 0): RobotMotionQueue {
  return { inFlight: null, pending: null, lastSequence }
}

export function enqueueRobotMotionCue(
  queue: RobotMotionQueue,
  cue: RobotMotionCue,
  sequence: number,
): RobotMotionQueue {
  if (sequence <= queue.lastSequence) return queue

  if (!queue.inFlight) return { inFlight: cue, pending: null, lastSequence: sequence }
  return { inFlight: queue.inFlight, pending: cue, lastSequence: sequence }
}

export function completeRobotMotionCue(
  queue: RobotMotionQueue,
  key: string,
): RobotMotionQueue {
  if (queue.inFlight?.key !== key) return queue
  return { inFlight: queue.pending, pending: null, lastSequence: queue.lastSequence }
}

export function getNodeTravelAnchors(
  sourceNodeKey: string,
  targetNodeKey: string,
  positions: Record<string, MotionNodePosition>,
  sizes: Record<string, MotionNodeSize>,
): NodeTravelAnchors | null {
  const sourcePosition = positions[sourceNodeKey]
  const targetPosition = positions[targetNodeKey]
  const sourceSize = sizes[sourceNodeKey]
  const targetSize = sizes[targetNodeKey]
  if (!sourcePosition || !targetPosition || !sourceSize || !targetSize) return null

  return {
    source: {
      x: sourcePosition.x + sourceSize.width,
      y: sourcePosition.y + sourceSize.height / 2,
    },
    target: {
      x: targetPosition.x,
      y: targetPosition.y + targetSize.height / 2,
    },
  }
}
