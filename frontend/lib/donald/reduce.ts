import {
  isNodeStatus,
  type DonaldEvent,
  type InterventionOption,
  type NodeSummary,
  type RunArtifact,
  type RunNode,
  type RunState,
} from './types'

const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null
const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const booleanValue = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null
const objectValue = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

export function createInitialRunState(runKey = 'latest'): RunState {
  return {
    run: {
      key: runKey,
      name: null,
      status: 'not_started',
      graph_revision: 0,
      plan_summary: null,
      summary_headline: null,
      summary_detail: null,
    },
    nodes: {},
    edges: {},
    event_log: [],
    open_intervention: null,
    last_sequence: 0,
    applied_idempotency_keys: {},
  }
}

function placeholderNode(event: DonaldEvent): RunNode | null {
  if (!event.node_key) return null
  return {
    node_key: event.node_key,
    label: stringValue(event.payload.label) ?? event.node_key,
    agent_label: event.agent_label,
    status: 'not_started',
    planned: booleanValue(event.payload.planned) ?? false,
    plan_order: numberValue(event.payload.plan_order),
    progress_percent: 0,
    estimated_seconds: numberValue(event.payload.estimated_seconds),
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: null,
    artifacts: [],
    removed: false,
  }
}

function summaryFromPayload(payload: Record<string, unknown>, previous: NodeSummary | null): NodeSummary | null {
  const headline = stringValue(payload.headline) ?? previous?.headline ?? null
  const detail = stringValue(payload.finding) ?? stringValue(payload.detail) ?? previous?.detail ?? null
  const metricsObject = objectValue(payload.metrics)
  const metrics = { ...(previous?.metrics ?? {}) }
  if (metricsObject) {
    for (const [key, value] of Object.entries(metricsObject)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') metrics[key] = value
    }
  }
  const evidenceIds = Array.isArray(payload.evidence_ids)
    ? payload.evidence_ids.filter((value): value is string => typeof value === 'string')
    : previous?.evidence_ids ?? []
  return headline || detail || Object.keys(metrics).length || evidenceIds.length
    ? { headline, detail, metrics, evidence_ids: evidenceIds }
    : previous
}

function artifactFromPayload(payload: Record<string, unknown>): RunArtifact {
  return {
    artifact_type: stringValue(payload.artifact_type) ?? 'unknown',
    name: stringValue(payload.name) ?? 'Untitled artifact',
    content_type: stringValue(payload.content_type),
    text_content: stringValue(payload.text_content),
    message_id: stringValue(payload.message_id),
  }
}

function interventionOptions(value: unknown): InterventionOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const option = objectValue(item)
    const id = option ? stringValue(option.id) : null
    const label = option ? stringValue(option.label) : null
    if (!option || !id || !label) return []
    return [{
      id,
      label,
      rationale: stringValue(option.rationale),
      rank: numberValue(option.rank),
      maximum_cost_usd: numberValue(option.maximum_cost_usd),
      client_commitment: stringValue(option.client_commitment),
      document: stringValue(option.document),
    }]
  })
}

function withNode(state: RunState, event: DonaldEvent, update: (node: RunNode) => RunNode): RunState {
  const current = event.node_key ? state.nodes[event.node_key] ?? placeholderNode(event) : null
  if (!current) return state
  return { ...state, nodes: { ...state.nodes, [current.node_key]: update(current) } }
}

export function applyEvent(state: RunState, event: DonaldEvent): RunState {
  if (state.applied_idempotency_keys[event.idempotency_key] || event.sequence <= state.last_sequence) return state

  let next: RunState = {
    ...state,
    event_log: [...state.event_log, event],
    last_sequence: event.sequence,
    applied_idempotency_keys: { ...state.applied_idempotency_keys, [event.idempotency_key]: true },
  }

  switch (event.event_type) {
    case 'run_started':
      next = {
        ...next,
        run: {
          ...next.run,
          key: stringValue(event.payload.run_key) ?? stringValue(event.payload.run_uuid) ?? next.run.key,
          name: stringValue(event.payload.name) ?? next.run.name,
          status: 'running',
        },
      }
      break
    case 'plan_declared': {
      const plan = objectValue(event.payload.plan)
      next = {
        ...next,
        run: {
          ...next.run,
          graph_revision: numberValue(event.payload.graph_revision) ?? next.run.graph_revision,
          plan_summary: (plan && stringValue(plan.summary)) ?? next.run.plan_summary,
        },
      }
      break
    }
    case 'node_added':
      next = withNode(next, event, (node) => ({
        ...node,
        label: stringValue(event.payload.label) ?? node.label,
        agent_label: event.agent_label ?? node.agent_label,
        planned: booleanValue(event.payload.planned) ?? node.planned,
        plan_order: numberValue(event.payload.plan_order) ?? node.plan_order,
        estimated_seconds: numberValue(event.payload.estimated_seconds) ?? node.estimated_seconds,
        removed: false,
        removed_at: null,
        removal_reason: null,
      }))
      break
    case 'node_removed':
      next = withNode(next, event, (node) => ({
        ...node,
        removed: true,
        removed_at: event.occurred_at,
        removal_reason: stringValue(event.payload.reason),
      }))
      break
    case 'edge_added': {
      const edgeKey = stringValue(event.payload.edge_key)
      const source = stringValue(event.payload.source_node_key)
      const target = stringValue(event.payload.target_node_key)
      if (edgeKey && source && target) {
        next = {
          ...next,
          edges: {
            ...next.edges,
            [edgeKey]: {
              edge_key: edgeKey,
              source_node_key: source,
              target_node_key: target,
              status: 'pending',
              planned: booleanValue(event.payload.planned) ?? false,
            },
          },
        }
      }
      break
    }
    case 'edge_removed': {
      const edgeKey = stringValue(event.payload.edge_key)
      const edge = edgeKey ? next.edges[edgeKey] : null
      if (edgeKey && edge) next = { ...next, edges: { ...next.edges, [edgeKey]: { ...edge, status: 'removed' } } }
      break
    }
    case 'node_status_changed': {
      const status = event.payload.status
      if (!isNodeStatus(status)) break
      next = withNode(next, event, (node) => ({
        ...node,
        status,
        estimated_seconds: numberValue(event.payload.estimated_seconds) ?? node.estimated_seconds,
        actual_seconds: numberValue(event.payload.actual_seconds) ?? node.actual_seconds,
        started_at: stringValue(event.payload.started_at) ?? node.started_at,
        finished_at: status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'skipped'
          ? stringValue(event.payload.finished_at) ?? event.occurred_at
          : node.finished_at,
        progress_percent: status === 'succeeded' ? 100 : node.progress_percent,
      }))
      if (event.node_key && status === 'succeeded') {
        next = {
          ...next,
          edges: Object.fromEntries(Object.entries(next.edges).map(([key, edge]) => [
            key,
            edge.target_node_key === event.node_key && edge.status !== 'removed' ? { ...edge, status: 'traversed' } : edge,
          ])),
        }
      }
      break
    }
    case 'node_updated':
      next = withNode(next, event, (node) => ({
        ...node,
        progress_percent: numberValue(event.payload.progress_percent) ?? node.progress_percent,
        elapsed_seconds: numberValue(event.payload.elapsed_seconds) ?? node.elapsed_seconds,
        input_summary: stringValue(event.payload.input_summary) ?? node.input_summary,
        output_summary: summaryFromPayload(event.payload, node.output_summary),
      }))
      break
    case 'artifact_added':
      next = withNode(next, event, (node) => ({ ...node, artifacts: [...node.artifacts, artifactFromPayload(event.payload)] }))
      break
    case 'intervention_requested': {
      next = withNode(next, event, (node) => ({ ...node, status: 'blocked_on_user_decision' }))
      next = {
        ...next,
        open_intervention: {
          type: stringValue(event.payload.type) ?? 'steer',
          node_key: event.node_key,
          prompt: stringValue(event.payload.prompt) ?? 'Decision required',
          requested_at: event.occurred_at,
          options: interventionOptions(event.payload.options),
        },
      }
      break
    }
    case 'intervention_resolved':
      if (next.open_intervention?.node_key) {
        const node = next.nodes[next.open_intervention.node_key]
        if (node?.status === 'blocked_on_user_decision') {
          next = { ...next, nodes: { ...next.nodes, [node.node_key]: { ...node, status: 'not_started' } } }
        }
      }
      next = { ...next, open_intervention: null }
      break
    case 'run_updated':
      next = {
        ...next,
        run: {
          ...next.run,
          graph_revision: numberValue(event.payload.graph_revision) ?? next.run.graph_revision,
          summary_detail: stringValue(event.payload.reason) ?? next.run.summary_detail,
        },
      }
      break
    case 'run_finished': {
      const summary = objectValue(event.payload.summary)
      next = {
        ...next,
        run: {
          ...next.run,
          status: 'finished',
          summary_headline: (summary && stringValue(summary.headline)) ?? next.run.summary_headline,
          summary_detail: (summary && stringValue(summary.detail)) ?? next.run.summary_detail,
        },
      }
      break
    }
    case 'agent_message':
      break
    default:
      break
  }

  return next
}

export function applyEvents(state: RunState, events: readonly DonaldEvent[]): RunState {
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reduce(applyEvent, state)
}
