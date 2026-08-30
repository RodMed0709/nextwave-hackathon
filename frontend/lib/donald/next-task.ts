import type { RunEdge, RunNode, RunState } from './types'

export type NextTaskState = 'waiting' | 'ready' | 'parallel' | 'human' | 'blocked' | 'complete'

export type NextTaskSummary = {
  state: NextTaskState
  label: string
  titles: string[]
  nodeKeys: string[]
}

const TERMINAL_STATUSES = new Set<RunNode['status']>(['succeeded', 'skipped', 'cancelled'])
const INCOMPLETE_STATUSES = new Set<RunNode['status']>(['not_started', 'in_progress', 'blocked_on_user_decision', 'blocked_on_missing_data', 'blocked_on_provider_outage'])

function activeNodes(nodes: Record<string, RunNode>): RunNode[] {
  return Object.values(nodes).filter((node) => !node.removed)
}

function isTerminal(node: RunNode | undefined): boolean {
  return Boolean(node && TERMINAL_STATUSES.has(node.status))
}

function isIncomplete(node: RunNode): boolean {
  return INCOMPLETE_STATUSES.has(node.status)
}

function usableIncomingEdges(node: RunNode, nodes: Record<string, RunNode>, edges: Record<string, RunEdge>): RunEdge[] {
  return Object.values(edges).filter((edge) =>
    edge.status !== 'removed' &&
    edge.target_node_key === node.node_key &&
    nodes[edge.source_node_key] &&
    !nodes[edge.source_node_key].removed,
  )
}

function readyNodes(nodes: Record<string, RunNode>, edges: Record<string, RunEdge>): RunNode[] {
  return activeNodes(nodes)
    .filter((node) => node.status === 'not_started')
    .filter((node) => usableIncomingEdges(node, nodes, edges).every((edge) => isTerminal(nodes[edge.source_node_key])))
    .sort(comparePlanOrder)
}

function nextAfterRunning(nodes: Record<string, RunNode>, edges: Record<string, RunEdge>): RunNode[] {
  const runningKeys = new Set(activeNodes(nodes).filter((node) => node.status === 'in_progress').map((node) => node.node_key))
  if (runningKeys.size === 0) return []

  return activeNodes(nodes)
    .filter((node) => node.status === 'not_started')
    .filter((node) => {
      const incoming = usableIncomingEdges(node, nodes, edges)
      if (!incoming.some((edge) => runningKeys.has(edge.source_node_key))) return false
      return incoming.every((edge) => runningKeys.has(edge.source_node_key) || isTerminal(nodes[edge.source_node_key]))
    })
    .sort(comparePlanOrder)
}

function comparePlanOrder(left: RunNode, right: RunNode): number {
  return (left.plan_order ?? Number.MAX_SAFE_INTEGER) - (right.plan_order ?? Number.MAX_SAFE_INTEGER) ||
    left.node_key.localeCompare(right.node_key)
}

function summarizeReady(nodes: RunNode[]): NextTaskSummary {
  if (nodes.length === 1) {
    return { state: 'ready', label: 'Next task in line', titles: [nodes[0].label], nodeKeys: [nodes[0].node_key] }
  }
  return {
    state: 'parallel',
    label: `${nodes.length} tasks ready`,
    titles: nodes.slice(0, 2).map((node) => node.label),
    nodeKeys: nodes.map((node) => node.node_key),
  }
}

export function getNextTaskSummary(state: Pick<RunState, 'nodes' | 'edges' | 'open_intervention' | 'run'>): NextTaskSummary {
  if (state.open_intervention) {
    return { state: 'human', label: 'Next task', titles: ['Waiting for your decision'], nodeKeys: state.open_intervention.node_key ? [state.open_intervention.node_key] : [] }
  }

  const nodes = activeNodes(state.nodes)
  if (nodes.length === 0) return { state: 'waiting', label: 'Next task in line', titles: ['Waiting for activity'], nodeKeys: [] }

  const incomplete = nodes.filter(isIncomplete)
  if (state.run.status === 'finished' || incomplete.length === 0) {
    return { state: 'complete', label: 'Next task in line', titles: ['No tasks remaining'], nodeKeys: [] }
  }

  const downstream = nextAfterRunning(state.nodes, state.edges)
  if (downstream.length > 0) return summarizeReady(downstream)

  const ready = readyNodes(state.nodes, state.edges)
  if (ready.length > 0) return summarizeReady(ready)

  const blocked = incomplete.find((node) => node.status.startsWith('blocked_on_') || node.status === 'failed')
  if (blocked) return { state: 'blocked', label: 'Next task', titles: [blocked.status === 'failed' ? 'Blocked after failure' : 'Waiting on blocked step'], nodeKeys: [blocked.node_key] }

  return { state: 'waiting', label: 'Next task in line', titles: ['Waiting for activity'], nodeKeys: [] }
}
