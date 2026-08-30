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
  url: string | null
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

  // What the agent said about the step beyond its label. All of this has been
  // stored since the first version of the protocol and only reached the browser
  // once the delta was widened to carry it.
  description: string | null
  node_type: string | null
  tool_name: string | null
  status_message: string | null
  error_message: string | null

  /**
   * How long this step would have taken a person, in minutes.
   *
   * Reported once, by whoever is in a position to know, and then stored in the
   * event log like everything else — never recomputed at render time. A savings
   * figure that changes each time the card is opened is worse than no figure at
   * all: this product's entire claim is that what you see can be trusted.
   */
  manual_minutes: number | null
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
  id: string
  type: string
  node_key: string | null
  prompt: string
  requested_at: string
  options: InterventionOption[]
}

/**
 * One stop or steer, from the moment it is raised to the moment the agent says
 * what it did about it.
 *
 * `origin` is the field that decides how the graph reacts. An agent asking a
 * question has stopped and is waiting, so its step is blocked. An operator
 * steering a step has not stopped anything — the agent is still working and will
 * see the instruction on its next check — so drawing that step as blocked would
 * claim a control we do not have.
 */
export type InterventionOrigin = 'operator' | 'agent'
export type InterventionStatus = 'queued' | 'delivered' | 'resolved'

export type InterventionRecord = {
  id: string
  type: string
  origin: InterventionOrigin
  node_key: string | null
  prompt: string
  options: InterventionOption[]
  status: InterventionStatus
  queued_at: string
  delivered_at: string | null
  resolved_at: string | null
  outcome: string | null
  response: string | null
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
  // Every intervention this run has seen, newest last, keyed by its id.
  interventions: Record<string, InterventionRecord>
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

// Sanitizing lives here, next to the guards, because BOTH the transport and the
// reducer have to do it. It used to live only in source.ts, which meant a
// snapshot reaching the reducer by any other path — a recorded fixture, a test,
// a future producer — was cast unchecked and could put a duplicate key or an
// unknown status in front of the renderer. A malformed subtask should cost you
// that subtask, never the card.
//
// Returns null when the value is not a list at all, which the caller reads as
// "say nothing about subtasks" rather than "the list is empty".
export function sanitizeSubtasks(value: unknown): RunSubtask[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const candidate = item as Record<string, unknown>
    const key = typeof candidate.key === 'string' ? candidate.key.trim() : ''
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : ''
    if (!key || !label || seen.has(key)) return []
    seen.add(key)
    return [{
      key,
      label,
      status: isRunSubtaskStatus(candidate.status) ? candidate.status : 'pending',
    }]
  })
}
