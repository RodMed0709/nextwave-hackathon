import { donaldActionIdForNode, isEmailNode, type DonaldActionId } from './action-presentation'
import type { RunNode } from './types'

/**
 * The run in three steps, for the person who will not read the graph.
 *
 * The detailed canvas answers "what exactly is happening"; this strip answers
 * "where are we" in language a CEO scans in two seconds: we watch, we solve,
 * we act. It is derived from the same nodes as everything else — the strip is
 * a summary of the graph, never a second source of truth.
 */
export type ExecutivePhaseId = 'watch' | 'solve' | 'act'
export type ExecutivePhaseState = 'waiting' | 'running' | 'done'

export type ExecutivePhase = {
  id: ExecutivePhaseId
  title: string
  detail: string
  state: ExecutivePhaseState
  /** Count of finished steps / total steps in the phase. */
  doneCount: number
  totalCount: number
}

const PHASE_OF_ACTION: Record<DonaldActionId, ExecutivePhaseId> = {
  ingest: 'watch',
  identify: 'watch',
  monitor: 'watch',
  detect: 'watch',
  extract: 'solve',
  reconcile: 'solve',
  explain: 'solve',
  impact: 'solve',
  predict: 'solve',
  plan: 'solve',
  decide: 'solve',
  act: 'act',
}

const PHASE_COPY: Record<ExecutivePhaseId, { title: string; detail: string }> = {
  watch: { title: 'Watching', detail: 'Every feed and document, around the clock' },
  solve: { title: 'Solving', detail: 'Root cause, impact, options — your call' },
  act: { title: 'Acting', detail: 'Bookings amended, everyone informed' },
}

const TERMINAL = new Set<RunNode['status']>(['succeeded', 'skipped', 'cancelled', 'failed'])

function phaseForNode(node: RunNode): ExecutivePhaseId {
  if (isEmailNode({ nodeKey: node.node_key, label: node.label, toolName: node.tool_name })) return 'act'
  const actionId = donaldActionIdForNode({
    nodeKey: node.node_key,
    label: node.label,
    nodeType: node.node_type,
    toolName: node.tool_name,
  })
  return actionId ? PHASE_OF_ACTION[actionId] : 'solve'
}

export function getExecutivePhases(nodes: Record<string, RunNode>): ExecutivePhase[] {
  const groups: Record<ExecutivePhaseId, RunNode[]> = { watch: [], solve: [], act: [] }
  for (const node of Object.values(nodes)) {
    if (node.removed) continue
    groups[phaseForNode(node)].push(node)
  }
  return (['watch', 'solve', 'act'] as const).map((id) => {
    const members = groups[id]
    const doneCount = members.filter((node) => TERMINAL.has(node.status)).length
    const anyActive = members.some((node) =>
      node.status === 'in_progress' || node.status.startsWith('blocked_on_'))
    // The watch never finishes: the whole pitch is that it keeps running after
    // the case closes, so it reads as live whenever it exists at all.
    const state: ExecutivePhaseState =
      id === 'watch' ? (members.length > 0 ? 'running' : 'waiting') :
      anyActive ? 'running' :
      members.length > 0 && doneCount === members.length ? 'done' :
      'waiting'
    return { id, ...PHASE_COPY[id], state, doneCount, totalCount: members.length }
  })
}
