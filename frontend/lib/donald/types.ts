export type NodeStatus =
  | 'not_started'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'blocked_on_user_decision'
  | 'blocked_on_missing_data'
  | 'blocked_on_provider_outage'
  | 'cancelled'
  | 'skipped'

export type EdgeStatus = 'pending' | 'traversed' | 'skipped' | 'removed'
export type RunStatus = 'not_started' | 'running' | 'finished' | 'failed' | 'cancelled'
export type RunSubtaskStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export type RunSubtask = {
  key: string
  label: string
  status: RunSubtaskStatus
}

export type DonaldEvent = {
  sequence: number
  event_type: string
  occurred_at: string
  agent_label: string | null
  node_key: string | null
  idempotency_key: string
  payload: Record<string, unknown>
}

export type RunArtifact = {
  artifact_type: string
  name: string
  content_type: string | null
  text_content: string | null
  message_id: string | null
}

export type NodeSummary = {
  headline: string | null
  detail: string | null
  metrics: Record<string, string | number | boolean>
  evidence_ids: string[]
}

export type RunNode = {
  node_key: string
  label: string
  agent_label: string | null
  status: NodeStatus
  planned: boolean
  plan_order: number | null
  progress_percent: number
  estimated_seconds: number | null
  elapsed_seconds?: number | null
  actual_seconds?: number | null
  started_at: string | null
  finished_at: string | null
  input_summary: string | null
  output_summary: NodeSummary | null
  subtasks?: RunSubtask[]
  artifacts: RunArtifact[]
  removed: boolean
  removed_at?: string | null
  removal_reason?: string | null
}

export type RunEdge = {
  edge_key: string
  source_node_key: string
  target_node_key: string
  status: EdgeStatus
  planned: boolean
}

export type InterventionOption = {
  id: string
  label: string
  rationale: string | null
  rank: number | null
  maximum_cost_usd: number | null
  client_commitment: string | null
  document: string | null
}

export type OpenIntervention = {
  type: string
  node_key: string | null
  prompt: string
  requested_at: string
  options: InterventionOption[]
}

export type RunState = {
  run: {
    key: string
    name: string | null
    status: RunStatus
    graph_revision: number
    plan_summary: string | null
    summary_headline: string | null
    summary_detail: string | null
  }
  nodes: Record<string, RunNode>
  edges: Record<string, RunEdge>
  event_log: DonaldEvent[]
  open_intervention: OpenIntervention | null
  last_sequence: number
  applied_idempotency_keys: Record<string, true>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDonaldEvent(value: unknown): value is DonaldEvent {
  if (!isRecord(value)) return false
  return (
    typeof value.sequence === 'number' &&
    Number.isInteger(value.sequence) &&
    value.sequence >= 0 &&
    typeof value.event_type === 'string' &&
    typeof value.occurred_at === 'string' &&
    (typeof value.agent_label === 'string' || value.agent_label === null) &&
    (typeof value.node_key === 'string' || value.node_key === null) &&
    typeof value.idempotency_key === 'string' &&
    isRecord(value.payload)
  )
}

export function isNodeStatus(value: unknown): value is NodeStatus {
  return (
    value === 'not_started' ||
    value === 'in_progress' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'blocked_on_user_decision' ||
    value === 'blocked_on_missing_data' ||
    value === 'blocked_on_provider_outage' ||
    value === 'cancelled' ||
    value === 'skipped'
  )
}

export function isRunSubtaskStatus(value: unknown): value is RunSubtaskStatus {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'skipped' || value === 'failed'
}
