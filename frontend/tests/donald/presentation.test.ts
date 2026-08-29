import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EDGE_LAND_DELAY_MS,
  NODE_STAGGER_MS,
  getGraphPresentation,
  getLatestNodeStatus,
  getVisiblyActiveNodeKey,
} from '../../lib/donald/presentation'
import type { DonaldEvent, RunNode } from '../../lib/donald/types'

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
    removed: false,
  }
}

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
