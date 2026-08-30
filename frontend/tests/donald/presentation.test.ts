import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EDGE_LAND_DELAY_MS,
  NODE_STAGGER_MS,
  getGraphPresentation,
  getNodeInterventions,
  getLatestNodeStatus,
  getLatestArtifact,
  getLatestReplan,
  getLatestRecalculation,
  getPrimaryMetric,
  getPlanRevealDurationMs,
  getRunRequest,
  getSubtaskPresentation,
  getVisiblyActiveNodeKey,
  metricRows,
  keepStillRemovedKeys,
  shouldShowInstructionForm,
} from '../../lib/donald/presentation'
import type { DonaldEvent, RunArtifact, RunNode } from '../../lib/donald/types'

function event(
  sequence: number,
  eventType: string,
  nodeKey: string | null,
  payload: Record<string, unknown>,
  occurredAt = '2026-08-29T11:20:00.000Z',
): DonaldEvent {
  return {
    sequence,
    event_type: eventType,
    occurred_at: occurredAt,
    agent_label: nodeKey ? 'Nina' : null,
    node_key: nodeKey,
    idempotency_key: `event-${sequence}`,
    payload,
  }
}

function node(nodeKey: string, status: RunNode['status'], planOrder: number): RunNode {
  return {
    node_key: nodeKey,
    label: nodeKey.replaceAll('-', ' '),
    agent_label: 'Nina',
    status,
    planned: true,
    plan_order: planOrder,
    progress_percent: 0,
    estimated_seconds: null,
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: null,
    artifacts: [],
    description: null,
    node_type: null,
    tool_name: null,
    status_message: null,
    error_message: null,
    manual_minutes: null,
    removed: false,
  }
}

test('custom instruction form is gated only while direct options are available', () => {
  assert.equal(shouldShowInstructionForm(2, false), false)
  assert.equal(shouldShowInstructionForm(2, true), true)
  assert.equal(shouldShowInstructionForm(0, false), true)
})

test('card artifact selection returns only the latest artifact', () => {
  const first: RunArtifact = {
    artifact_type: 'document', name: 'initial.md', content_type: 'text/markdown',
    text_content: null, message_id: null, url: null,
  }
  const latest: RunArtifact = {
    artifact_type: 'document', name: 'final.md', content_type: 'text/markdown',
    text_content: null, message_id: null, url: null,
  }

  assert.equal(getLatestArtifact([first, latest]), latest)
  assert.equal(getLatestArtifact([]), null)
})

test('graph presentation staggers planned nodes and draws each edge after its target lands', () => {
  const events = [
    event(1, 'node_added', 'alpha', { planned: true, plan_order: 1 }),
    event(2, 'node_added', 'beta', { planned: true, plan_order: 2 }),
    event(3, 'node_added', 'gamma', { planned: true, plan_order: 3 }),
    event(4, 'edge_added', null, { edge_key: 'alpha-beta', source_node_key: 'alpha', target_node_key: 'beta' }),
    event(5, 'edge_added', null, { edge_key: 'beta-gamma', source_node_key: 'beta', target_node_key: 'gamma' }),
  ]

  const presentation = getGraphPresentation(events)

  assert.deepEqual(presentation.nodes.alpha, { delayMs: 0, discovered: false, batch: 1 })
  assert.deepEqual(presentation.nodes.beta, { delayMs: NODE_STAGGER_MS, discovered: false, batch: 1 })
  assert.equal(presentation.edges['alpha-beta'].delayMs, NODE_STAGGER_MS + EDGE_LAND_DELAY_MS)
  assert.equal(presentation.edges['beta-gamma'].delayMs, NODE_STAGGER_MS * 2 + EDGE_LAND_DELAY_MS)
})

test('plan reveal duration leaves time for the final node and edge to land', () => {
  const declared = event(1, 'plan_declared', null, {
    plan: { steps: [{ node_key: 'alpha' }, { node_key: 'beta' }, { node_key: 'gamma' }] },
  })

  assert.equal(getPlanRevealDurationMs(declared), NODE_STAGGER_MS * 2 + EDGE_LAND_DELAY_MS + 340)
})

test('nodes added after work begins are marked discovered and stagger within their structural batch', () => {
  const events = [
    event(1, 'node_added', 'alpha', { planned: true }),
    event(2, 'node_status_changed', 'alpha', { status: 'in_progress' }),
    event(3, 'node_updated', 'alpha', { progress_percent: 30 }, '2026-08-29T11:20:01.000Z'),
    event(4, 'node_added', 'delta', { planned: true }, '2026-08-29T11:20:02.000Z'),
    event(5, 'node_added', 'epsilon', { planned: true }, '2026-08-29T11:20:02.000Z'),
  ]

  const presentation = getGraphPresentation(events)

  assert.deepEqual(presentation.nodes.delta, { delayMs: 0, discovered: true, batch: 2 })
  assert.deepEqual(presentation.nodes.epsilon, { delayMs: NODE_STAGGER_MS, discovered: true, batch: 2 })
})

test('the most recently started in-progress node is the only visibly active node', () => {
  const nodes = {
    earlier: node('earlier', 'in_progress', 9),
    latest: node('latest', 'in_progress', 1),
  }
  const events = [
    event(1, 'node_status_changed', 'earlier', { status: 'in_progress' }),
    event(2, 'node_status_changed', 'latest', { status: 'in_progress' }),
  ]

  assert.equal(getVisiblyActiveNodeKey(nodes, events), 'latest')
})

test('live status prefers event copy and otherwise narrates progress without a percentage', () => {
  const activeNode = node('reconcile-booking', 'in_progress', 1)
  const updates = [
    event(1, 'node_status_changed', activeNode.node_key, { status: 'in_progress' }),
    event(2, 'node_updated', activeNode.node_key, { progress_percent: 15 }),
    event(3, 'node_updated', activeNode.node_key, { progress_percent: 60 }),
  ]

  assert.deepEqual(getLatestNodeStatus(activeNode, updates), {
    key: 'event-3',
    text: 'Nina is working on reconcile booking',
  })
  assert.doesNotMatch(getLatestNodeStatus(activeNode, updates)?.text ?? '', /%|percent/i)

  const narrated = event(4, 'node_updated', activeNode.node_key, {
    status_message: 'Reconciling against booking BK-3341',
    progress_percent: 75,
  })
  assert.deepEqual(getLatestNodeStatus(activeNode, [...updates, narrated]), {
    key: 'event-4',
    text: 'Reconciling against booking BK-3341',
  })
})

test('live status surfaces the latest node-scoped agent message', () => {
  const activeNode = node('reconcile-booking', 'in_progress', 1)
  const events = [
    event(1, 'node_updated', activeNode.node_key, { progress_percent: 60 }),
    event(2, 'agent_message', activeNode.node_key, { message: 'Theo is taking longer than expected.' }),
  ]

  assert.deepEqual(getLatestNodeStatus(activeNode, events), {
    key: 'event-2',
    text: 'Theo is taking longer than expected.',
  })
})

test('live status never exposes raw detail for a typed subtask snapshot', () => {
  const activeNode = node('approve-animation-slice', 'in_progress', 1)
  const subtasks = [{ key: 'review-frames', label: 'Review the key frames', status: 'pending' }]
  const started = event(1, 'node_status_changed', activeNode.node_key, {
    status: 'in_progress',
    detail: JSON.stringify({ subtasks }),
    subtasks,
  })

  assert.deepEqual(getLatestNodeStatus(activeNode, [started]), {
    key: 'event-1',
    text: 'Nina is starting approve animation slice',
  })
})

test('subtask presentation maps every status to its icon and label treatment', () => {
  assert.deepEqual([
    getSubtaskPresentation('pending'),
    getSubtaskPresentation('running'),
    getSubtaskPresentation('done'),
    getSubtaskPresentation('skipped'),
    getSubtaskPresentation('failed'),
  ], [
    { icon: 'ring', tone: 'muted', struck: false },
    { icon: 'spinner', tone: 'emphasis', struck: false },
    { icon: 'check', tone: 'muted', struck: true },
    { icon: 'minus', tone: 'muted', struck: true },
    { icon: 'x', tone: 'failed', struck: false },
  ])
})

test('hidden presentation keys are released when an element is re-added', () => {
  const hidden = new Set(['still-removed', 're-added'])

  assert.deepEqual(keepStillRemovedKeys(hidden, ['still-removed']), new Set(['still-removed']))
  assert.equal(keepStillRemovedKeys(hidden, ['still-removed', 're-added']), hidden)
})

test('the operator request comes from run state and falls back to the run key', () => {
  const run = {
    key: 'OP-4471',
    status: 'running' as const,
    graph_revision: 1,
    name: 'Resolve the delayed OP-4471 shipment',
    plan_summary: 'Validate the change',
    summary_headline: null,
    summary_detail: null,
  }

  assert.equal(getRunRequest(run), 'Resolve the delayed OP-4471 shipment')
  assert.equal(getRunRequest({ ...run, name: null }), 'Validate the change')
  assert.equal(getRunRequest({ ...run, name: null, plan_summary: null }), 'OP-4471')
})

test('metrics put money before days and render operational labels', () => {
  const rows = metricRows({ affected_containers: 3, delay_days: 9, estimated_cost_usd: 3780 })

  assert.deepEqual(rows, [
    { key: 'estimated_cost_usd', label: 'Estimated cost', value: '$3,780 USD', severity: 3 },
    { key: 'delay_days', label: 'Delay', value: '9 days', severity: 2 },
    { key: 'affected_containers', label: 'Affected containers', value: '3', severity: 1 },
  ])
  assert.deepEqual(getPrimaryMetric({ affected_containers: 3, estimated_cost_usd: 3780 }), rows[0])
})

test('the latest replan exposes its cause and evidence from the event', () => {
  const replan = event(9, 'run_updated', null, {
    graph_revision: 2,
    reason: 'The original Bill of Lading is invalid.',
    triggered_by: 'reconcile-booking',
    evidence: ['MSG-3312'],
  })

  assert.deepEqual(getLatestReplan([replan]), {
    key: 'event-9',
    revision: 2,
    reason: 'The original Bill of Lading is invalid.',
    triggeredBy: 'reconcile-booking',
    evidenceIds: ['MSG-3312'],
  })
})

test('a single mid-run node addition triggers a smaller recalculation notice', () => {
  const events = [
    event(1, 'node_added', 'alpha', { label: 'Initial step' }),
    event(2, 'node_status_changed', 'alpha', { status: 'in_progress' }),
    event(3, 'node_added', 'delta', { label: 'Validate new document' }),
  ]

  assert.deepEqual(getLatestRecalculation(events), {
    key: 'event-3',
    kind: 'addition',
    reason: null,
    evidenceIds: [],
  })
})

test('a later standalone addition supersedes an older completed replan notice', () => {
  const events = [
    event(1, 'node_status_changed', 'alpha', { status: 'in_progress' }),
    event(2, 'run_updated', null, { graph_revision: 2, reason: 'Route changed.' }),
    event(3, 'node_added', 'replan-step', { label: 'Replan step' }),
    event(4, 'node_status_changed', 'replan-step', { status: 'in_progress' }),
    event(5, 'node_added', 'standalone', { label: 'Standalone validation' }),
  ]

  assert.deepEqual(getLatestRecalculation(events), {
    key: 'event-5',
    kind: 'addition',
    reason: null,
    evidenceIds: [],
  })
})

test('interventions for one node come back newest first and exclude other nodes', () => {
  const interventions = {
    'iv-1': {
      id: 'iv-1', type: 'steer', origin: 'operator' as const, node_key: 'decide-response',
      prompt: 'Hold the booking', options: [], status: 'resolved' as const,
      queued_at: '2026-08-29T11:20:00.000Z', delivered_at: '2026-08-29T11:20:04.000Z',
      resolved_at: '2026-08-29T11:20:09.000Z', outcome: 'succeeded', response: 'Held it',
    },
    'iv-2': {
      id: 'iv-2', type: 'stop', origin: 'operator' as const, node_key: 'decide-response',
      prompt: 'Stop this', options: [], status: 'queued' as const,
      queued_at: '2026-08-29T11:21:00.000Z', delivered_at: null,
      resolved_at: null, outcome: null, response: null,
    },
    'iv-3': {
      id: 'iv-3', type: 'steer', origin: 'agent' as const, node_key: 'another-node',
      prompt: 'Which option?', options: [], status: 'queued' as const,
      queued_at: '2026-08-29T11:22:00.000Z', delivered_at: null,
      resolved_at: null, outcome: null, response: null,
    },
  }

  const forNode = getNodeInterventions(interventions, 'decide-response')
  assert.deepEqual(forNode.map((record) => record.id), ['iv-2', 'iv-1'])
  assert.deepEqual(getNodeInterventions(interventions, 'missing-node'), [])
})
