import {
  isNodeStatus,
  type DonaldEvent,
  type InterventionOption,
  type InterventionOrigin,
  type InterventionRecord,
  type NodeSummary,
  type RunArtifact,
  type RunNode,
  type RunState,
  type RunSubtask,
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
    interventions: {},
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
    description: null,
    node_type: null,
    tool_name: null,
    status_message: null,
    error_message: null,
    manual_minutes: null,
  }
}

/**
 * The node facts the server attaches to every event about a node.
 *
 * They are read from the node row at the time the delta is built, so the newest
 * event always carries the truest values — which is why this merges rather than
 * overwrites: an event that omits a field must not erase what an earlier one
 * established.
 */
function nodeFactsFromPayload(payload: Record<string, unknown>, node: RunNode): Partial<RunNode> {
  return {
    description: stringValue(payload.description) ?? node.description,
    node_type: stringValue(payload.node_type) ?? node.node_type,
    tool_name: stringValue(payload.tool_name) ?? node.tool_name,
    status_message: stringValue(payload.status_message) ?? stringValue(payload.message) ?? node.status_message,
    error_message: stringValue(payload.error_message) ?? node.error_message,
    manual_minutes: numberValue(payload.manual_minutes) ?? node.manual_minutes,
  }
}

function summaryFromPayload(payload: Record<string, unknown>, previous: NodeSummary | null): NodeSummary | null {
  const headline = stringValue(payload.headline) ?? previous?.headline ?? null
  const findingDetail = Array.isArray(payload.subtasks) ? null : stringValue(payload.detail)
  const detail = stringValue(payload.finding) ?? findingDetail ?? previous?.detail ?? null
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

function subtaskSnapshot(payload: Record<string, unknown>): RunSubtask[] | undefined {
  return Array.isArray(payload.subtasks) ? payload.subtasks as RunSubtask[] : undefined
}

function artifactFromPayload(payload: Record<string, unknown>): RunArtifact {
  // Two spellings on purpose. The recorded fixture names these fields plainly;
  // the live delta prefixes them (artifact_name, artifact_text) because the
  // payload is flat and `name` already means the node's name there.
  return {
    artifact_type: stringValue(payload.artifact_type) ?? 'unknown',
    name: stringValue(payload.artifact_name) ?? stringValue(payload.name) ?? stringValue(payload.message) ?? 'Untitled artifact',
    content_type: stringValue(payload.content_type),
    text_content: stringValue(payload.artifact_text) ?? stringValue(payload.text_content),
    message_id: stringValue(payload.message_id),
    url: stringValue(payload.artifact_url) ?? stringValue(payload.url),
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

/**
 * The id that ties requested → delivered → resolved together.
 *
 * The live stream carries a real intervention_id on all three events. The
 * recorded fixture predates that field, so its single request falls back to the
 * node key: the fixture has one intervention per node, which makes that unique
 * where it is used.
 */
function interventionId(event: DonaldEvent): string {
  return stringValue(event.payload.intervention_id) ??
    stringValue(event.payload.intervention_uuid) ??
    event.node_key ??
    event.idempotency_key
}

function interventionOrigin(event: DonaldEvent): InterventionOrigin {
  return stringValue(event.payload.origin) === 'operator' ? 'operator' : 'agent'
}

function withNode(state: RunState, event: DonaldEvent, update: (node: RunNode) => RunNode): RunState {
  const current = event.node_key ? state.nodes[event.node_key] ?? placeholderNode(event) : null
  if (!current) return state
  return { ...state, nodes: { ...state.nodes, [current.node_key]: update(current) } }
}

export function applyEvent(state: RunState, event: DonaldEvent): RunState {
  if (state.applied_idempotency_keys[event.idempotency_key] || event.sequence <= state.last_sequence) return state

  // The run's name rides every delta, not just run_started, so a browser that
  // opens a run already in flight gets a real heading immediately instead of
  // waiting for a replay of event one.
  const runName = stringValue(event.payload.run_name)
  const runSummary = stringValue(event.payload.run_summary)

  let next: RunState = {
    ...state,
    run: runName || runSummary
      ? { ...state.run, name: runName ?? state.run.name, plan_summary: runSummary ?? state.run.plan_summary }
      : state.run,
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
          // run_name is what the live stream calls it; name is the recorded
          // fixture's spelling. Without either the heading falls back to the
          // run_key, which is an addressing slug, not a title for a person.
          name: stringValue(event.payload.run_name) ?? stringValue(event.payload.name) ?? next.run.name,
          plan_summary: stringValue(event.payload.run_summary) ?? stringValue(event.payload.message) ?? next.run.plan_summary,
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

      // A declared plan MATERIALISES its graph.
      //
      // Donald declares a plan as one atomic event rather than a burst of
      // node_added/edge_added, because the whole plan is one decision by the
      // agent. Reading only `summary` here left the reducer with no edges at
      // all, so every run rendered as a straight line of nodes whatever shape
      // the agent actually declared — the fan-outs and joins were in the payload
      // and silently dropped.
      //
      // node_added/edge_added are still handled below and still apply: they are
      // how work DISCOVERED mid-run arrives. This case covers the up-front plan.
      const steps = Array.isArray(plan?.steps) ? plan.steps : []
      for (const raw of steps) {
        const step = objectValue(raw)
        const key = step && stringValue(step.node_key)
        if (!step || !key) continue
        const existing = next.nodes[key]
        next = {
          ...next,
          nodes: {
            ...next.nodes,
            [key]: {
              ...(existing ?? {
                node_key: key,
                status: 'not_started' as const,
                progress_percent: 0,
                started_at: null,
                finished_at: null,
                input_summary: null,
                output_summary: null,
                artifacts: [],
                removed: false,
                node_type: null,
                tool_name: null,
                status_message: null,
                error_message: null,
                manual_minutes: null,
              }),
              description: stringValue(step.description) ?? existing?.description ?? null,
              label: stringValue(step.label) ?? existing?.label ?? key,
              agent_label: stringValue(step.agent_label) ?? existing?.agent_label ?? null,
              planned: booleanValue(step.planned) ?? true,
              plan_order: numberValue(step.plan_order) ?? existing?.plan_order ?? null,
              estimated_seconds: numberValue(step.estimated_seconds) ?? existing?.estimated_seconds ?? null,
            } as RunNode,
          },
        }
      }

      const planEdges = Array.isArray(plan?.edges) ? plan.edges : []
      for (const raw of planEdges) {
        const edge = objectValue(raw)
        const source = edge && stringValue(edge.source_node_key)
        const target = edge && stringValue(edge.target_node_key)
        if (!edge || !source || !target) continue
        const edgeKey = stringValue(edge.edge_key) ?? `${source}->${target}`
        next = {
          ...next,
          edges: {
            ...next.edges,
            [edgeKey]: {
              edge_key: edgeKey,
              source_node_key: source,
              target_node_key: target,
              status: 'pending',
              planned: true,
            },
          },
        }
      }
      break
    }
    case 'node_added': {
      // A discovered node usually arrives WITH the edge that hangs it off its
      // predecessor: add_action creates both in one atomic mutation, so there is
      // no separate edge_added to wait for. Missing this made every discovered
      // node look like a root and pushed it to the far left of the graph,
      // alongside step one, instead of after the step that found it.
      const source = stringValue(event.payload.source_node_key)
      const target = stringValue(event.payload.target_node_key)
      if (source && target) {
        const edgeKey = stringValue(event.payload.edge_key) ?? `${source}->${target}`
        next = {
          ...next,
          edges: {
            ...next.edges,
            [edgeKey]: {
              edge_key: edgeKey,
              source_node_key: source,
              target_node_key: target,
              status: 'pending',
              planned: false,
            },
          },
        }
      }
      next = withNode(next, event, (node) => ({
        ...node,
        ...nodeFactsFromPayload(event.payload, node),
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
    }
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
      const subtasks = subtaskSnapshot(event.payload)
      next = withNode(next, event, (node) => ({
        ...node,
        ...nodeFactsFromPayload(event.payload, node),
        status,
        estimated_seconds: numberValue(event.payload.estimated_seconds) ?? node.estimated_seconds,
        manual_minutes: numberValue(event.payload.manual_minutes) ?? node.manual_minutes,
        actual_seconds: numberValue(event.payload.actual_seconds) ?? node.actual_seconds,
        started_at: stringValue(event.payload.started_at) ?? node.started_at,
        finished_at: status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'skipped'
          ? stringValue(event.payload.finished_at) ?? event.occurred_at
          : node.finished_at,
        progress_percent: status === 'succeeded' ? 100 : node.progress_percent,
        ...(subtasks !== undefined ? { subtasks } : {}),
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
    case 'node_updated': {
      const subtasks = subtaskSnapshot(event.payload)
      next = withNode(next, event, (node) => ({
        ...node,
        ...nodeFactsFromPayload(event.payload, node),
        progress_percent: numberValue(event.payload.progress_percent) ?? node.progress_percent,
        elapsed_seconds: numberValue(event.payload.elapsed_seconds) ?? node.elapsed_seconds,
        input_summary: stringValue(event.payload.input_summary) ?? node.input_summary,
        output_summary: summaryFromPayload(event.payload, node.output_summary),
        ...(subtasks !== undefined ? { subtasks } : {}),
      }))
      break
    }
    case 'artifact_added':
      next = withNode(next, event, (node) => ({ ...node, artifacts: [...node.artifacts, artifactFromPayload(event.payload)] }))
      break
    case 'intervention_requested': {
      const id = interventionId(event)
      const origin = interventionOrigin(event)
      // A request can be applied twice: the browser that raised it draws a local
      // echo immediately and the server's own event follows on the stream. The
      // event carries the newest description of the request; the lifecycle
      // carries how far it has got, and must survive being described again.
      const previous = next.interventions[id]
      const record: InterventionRecord = {
        id,
        type: stringValue(event.payload.type) ?? previous?.type ?? 'steer',
        origin,
        node_key: event.node_key ?? previous?.node_key ?? null,
        prompt: stringValue(event.payload.prompt) ?? stringValue(event.payload.message) ?? previous?.prompt ?? 'Decision required',
        options: interventionOptions(event.payload.options),
        status: previous?.status ?? 'queued',
        queued_at: previous?.queued_at ?? event.occurred_at,
        delivered_at: previous?.delivered_at ?? null,
        resolved_at: previous?.resolved_at ?? null,
        outcome: previous?.outcome ?? null,
        response: previous?.response ?? null,
      }
      next = { ...next, interventions: { ...next.interventions, [id]: record } }

      // Only an agent asking a question blocks its own step. An operator
      // steering a running step changes nothing about what the agent is doing
      // right now — it will see the instruction on its next check — and drawing
      // the step as blocked would claim a brake we do not have.
      if (origin === 'agent') {
        next = withNode(next, event, (node) => ({ ...node, status: 'blocked_on_user_decision' }))
        next = {
          ...next,
          open_intervention: {
            id,
            type: record.type,
            node_key: event.node_key,
            prompt: record.prompt,
            requested_at: event.occurred_at,
            options: record.options,
          },
        }
      }
      break
    }
    case 'intervention_delivered': {
      const id = interventionId(event)
      const existing = next.interventions[id]
      if (existing) {
        next = {
          ...next,
          interventions: {
            ...next.interventions,
            [id]: { ...existing, status: existing.status === 'resolved' ? 'resolved' : 'delivered', delivered_at: event.occurred_at },
          },
        }
      }
      break
    }
    case 'intervention_resolved': {
      const id = interventionId(event)
      const existing = next.interventions[id]
      if (existing) {
        next = {
          ...next,
          interventions: {
            ...next.interventions,
            [id]: {
              ...existing,
              status: 'resolved',
              resolved_at: event.occurred_at,
              outcome: stringValue(event.payload.outcome) ?? stringValue(event.payload.intervention_status),
              response: stringValue(event.payload.message),
            },
          },
        }
      }
      if (next.open_intervention?.node_key) {
        const node = next.nodes[next.open_intervention.node_key]
        if (node?.status === 'blocked_on_user_decision') {
          next = { ...next, nodes: { ...next.nodes, [node.node_key]: { ...node, status: 'not_started' } } }
        }
      }
      next = { ...next, open_intervention: null }
      break
    }
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
