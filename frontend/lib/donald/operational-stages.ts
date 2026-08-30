import { donaldActionIdForNode, type DonaldActionId } from './action-presentation'
import type { DonaldEvent, RunNode } from './types'

export type OperationalStageId = 'above' | 'below' | 'unclassified'

export type OperationalStageDefinition = {
  id: OperationalStageId
  eyebrow: string
  title: string
  description: string
  capabilities: string[]
}

export type OperationalStageState = 'healthy' | 'in-progress' | 'needs-human' | 'complete' | 'empty'

export type OperationalStageSummary = OperationalStageDefinition & {
  state: OperationalStageState
  completeActions: number
  totalActions: number
  agentLabels: string[]
  nodeKeys: string[]
}

export type ConnectedAgent = {
  label: string
  role: string | null
}

export type ClientProjectMetadata = {
  clientName: string | null
  business: string | null
  projectGoal: string | null
  agents: ConnectedAgent[]
}

export const OPERATIONAL_STAGES: OperationalStageDefinition[] = [
  {
    id: 'above',
    eyebrow: 'Above the Line',
    title: 'Ambient Visibility',
    description: 'Always-on awareness across documents, entities, and live operations.',
    capabilities: ['Ingest', 'Identify', 'Monitor'],
  },
  {
    id: 'below',
    eyebrow: 'Below the Line',
    title: 'Targeted Response',
    description: 'Investigation and action after Donald observes a signal that needs attention.',
    capabilities: ['Predict', 'Detect', 'Extract', 'Reconcile', 'Explain', 'Impact', 'Plan', 'Decide', 'Act'],
  },
  {
    id: 'unclassified',
    eyebrow: 'Neutral',
    title: 'Unclassified Work',
    description: 'Runtime actions without a known Donald presentation mapping.',
    capabilities: ['Mapped when a presentation action is available'],
  },
]

const AMBIENT_ACTIONS = new Set<DonaldActionId>(['ingest', 'identify', 'monitor'])
const TARGETED_ACTIONS = new Set<DonaldActionId>([
  'predict',
  'detect',
  'extract',
  'reconcile',
  'explain',
  'impact',
  'plan',
  'decide',
  'act',
])

const ACTION_LABELS: Record<DonaldActionId, string> = {
  ingest: 'Ingest',
  identify: 'Identify',
  extract: 'Extract',
  reconcile: 'Reconcile',
  monitor: 'Monitor',
  detect: 'Detect',
  explain: 'Explain',
  impact: 'Impact',
  predict: 'Predict',
  plan: 'Plan',
  decide: 'Decide',
  act: 'Act',
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function operationalStageForNode(node: RunNode): OperationalStageId {
  const actionId = donaldActionIdForNode({
    nodeKey: node.node_key,
    label: node.label,
    nodeType: node.node_type,
  })

  if (!actionId) return 'unclassified'
  if (AMBIENT_ACTIONS.has(actionId)) return 'above'
  if (TARGETED_ACTIONS.has(actionId)) return 'below'
  return 'unclassified'
}

export function operationalStageState(nodes: RunNode[], stageId: OperationalStageId): OperationalStageState {
  const activeNodes = nodes.filter((node) => !node.removed)
  if (activeNodes.length === 0) return 'empty'
  if (activeNodes.some((node) => node.status.startsWith('blocked_on_') || node.status === 'failed')) return 'needs-human'
  if (activeNodes.some((node) => node.status === 'in_progress')) return 'in-progress'
  if (activeNodes.every((node) => node.status === 'succeeded' || node.status === 'skipped' || node.status === 'cancelled')) {
    return 'complete'
  }
  return stageId === 'above' ? 'healthy' : 'in-progress'
}

export function summarizeOperationalStages(nodes: Record<string, RunNode>): OperationalStageSummary[] {
  const grouped = new Map<OperationalStageId, RunNode[]>(OPERATIONAL_STAGES.map((stage) => [stage.id, []]))
  for (const node of Object.values(nodes)) {
    grouped.get(operationalStageForNode(node))?.push(node)
  }

  return OPERATIONAL_STAGES.flatMap((stage) => {
    const stageNodes = grouped.get(stage.id) ?? []
    if (stage.id === 'unclassified' && stageNodes.length === 0) return []
    const counted = stageNodes.filter((node) => !node.removed)
    const presentActions = [...new Set(counted.flatMap((node) => {
      const actionId = donaldActionIdForNode({ nodeKey: node.node_key, label: node.label, nodeType: node.node_type })
      return actionId ? [actionId] : []
    }))]
    const completeActions = counted.filter((node) =>
      node.status === 'succeeded' || node.status === 'skipped' || node.status === 'cancelled',
    ).length
    const agentLabels = [...new Set(stageNodes.flatMap((node) => node.agent_label ? [node.agent_label] : []))]
    return [{
      ...stage,
      capabilities: stage.id === 'unclassified' ? stage.capabilities : presentActions.map((actionId) => ACTION_LABELS[actionId]),
      state: operationalStageState(stageNodes, stage.id),
      completeActions,
      totalActions: counted.length,
      agentLabels,
      nodeKeys: stageNodes.map((node) => node.node_key),
    }]
  })
}

export function clientProjectMetadata(events: readonly DonaldEvent[], fallbackGoal: string | null): ClientProjectMetadata {
  const started = events.find((event) => event.event_type === 'run_started')
  const payload = started?.payload ?? {}
  const agents = Array.isArray(payload.agents)
    ? payload.agents.flatMap((agent): ConnectedAgent[] => {
      if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return []
      const record = agent as Record<string, unknown>
      const label = stringValue(record.label)
      if (!label) return []
      return [{ label, role: stringValue(record.role) }]
    })
    : []

  return {
    clientName: stringValue(payload.client_name) ??
      stringValue(payload.client) ??
      stringValue(payload.customer_name) ??
      stringValue(payload.customer) ??
      stringValue(payload.account_name) ??
      stringValue(payload.account),
    business: stringValue(payload.business) ??
      stringValue(payload.industry) ??
      stringValue(payload.vertical) ??
      stringValue(payload.business_type),
    projectGoal: stringValue(payload.project_goal) ??
      stringValue(payload.implementation_goal) ??
      stringValue(payload.run_summary) ??
      fallbackGoal,
    agents,
  }
}
