import type { DonaldEvent, RunNode } from './types'

export const NODE_STAGGER_MS = 120
export const EDGE_LAND_DELAY_MS = 220

export type NodePresentation = {
  delayMs: number
  discovered: boolean
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

const STRUCTURAL_EVENT_TYPES = new Set([
  'node_added',
  'node_removed',
  'edge_added',
  'edge_removed',
])

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getGraphPresentation(events: readonly DonaldEvent[]): GraphPresentation {
  const nodes: Record<string, NodePresentation> = {}
  const edges: Record<string, EdgePresentation> = {}
  let batch = 0
  let additionsInBatch = 0
  let insideStructuralBatch = false
  let workHasStarted = false

  for (const event of events) {
    const structural = STRUCTURAL_EVENT_TYPES.has(event.event_type)
    if (structural && !insideStructuralBatch) {
      batch += 1
      additionsInBatch = 0
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
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event.event_type === 'node_status_changed' &&
      event.payload.status === 'in_progress' &&
      event.node_key &&
      nodes[event.node_key]?.status === 'in_progress' &&
      !nodes[event.node_key].removed
    ) {
      return event.node_key
    }
  }

  return Object.values(nodes)
    .filter((node) => node.status === 'in_progress' && !node.removed)
    .sort((left, right) => Date.parse(right.started_at ?? '') - Date.parse(left.started_at ?? ''))[0]?.node_key ?? null
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
    if (event.event_type !== 'node_updated' && event.event_type !== 'node_status_changed') continue

    const text = stringValue(event.payload.status_message) ??
      stringValue(event.payload.message) ??
      stringValue(event.payload.headline) ??
      stringValue(event.payload.finding) ??
      stringValue(event.payload.detail) ??
      fallbackStatus(node, event)
    return { key: event.idempotency_key, text }
  }

  return null
}
