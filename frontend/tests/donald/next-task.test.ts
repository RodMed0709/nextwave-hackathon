import assert from 'node:assert/strict'
import test from 'node:test'
import { getNextTaskSummary } from '../../lib/donald/next-task'
import type { OpenIntervention, RunEdge, RunNode, RunState } from '../../lib/donald/types'

function node(overrides: Partial<RunNode> & { node_key: string; label: string }): RunNode {
  return {
    node_key: overrides.node_key,
    label: overrides.label,
    agent_label: null,
    status: overrides.status ?? 'not_started',
    planned: overrides.planned ?? true,
    plan_order: overrides.plan_order ?? null,
    progress_percent: 0,
    estimated_seconds: null,
    elapsed_seconds: null,
    actual_seconds: null,
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: null,
    subtasks: undefined,
    artifacts: [],
    removed: overrides.removed ?? false,
    description: null,
    node_type: null,
    tool_name: null,
    status_message: null,
    error_message: null,
    manual_minutes: null,
  }
}

function edge(source: string, target: string): RunEdge {
  return {
    edge_key: `${source}-to-${target}`,
    source_node_key: source,
    target_node_key: target,
    status: 'pending',
    planned: true,
  }
}

function state(overrides: {
  nodes?: Record<string, RunNode>
  edges?: Record<string, RunEdge>
  open_intervention?: OpenIntervention | null
  runStatus?: RunState['run']['status']
} = {}): Pick<RunState, 'nodes' | 'edges' | 'open_intervention' | 'run'> {
  return {
    nodes: overrides.nodes ?? {},
    edges: overrides.edges ?? {},
    open_intervention: overrides.open_intervention ?? null,
    run: {
      key: 'test',
      name: null,
      status: overrides.runStatus ?? 'running',
      graph_revision: 1,
      plan_summary: null,
      summary_headline: null,
      summary_detail: null,
    },
  }
}

test('running node prefers eligible downstream proposed node as next', () => {
  const nodes = {
    reconcile: node({ node_key: 'reconcile', label: 'Reconcile booking', status: 'in_progress', plan_order: 1 }),
    plan: node({ node_key: 'plan', label: 'Generate and rank response options', status: 'not_started', plan_order: 2 }),
  }
  const summary = getNextTaskSummary(state({ nodes, edges: { one: edge('reconcile', 'plan') } }))

  assert.equal(summary.state, 'ready')
  assert.deepEqual(summary.titles, ['Generate and rank response options'])
  assert.deepEqual(summary.nodeKeys, ['plan'])
})

test('multiple eligible parallel nodes are reported together', () => {
  const nodes = {
    extract: node({ node_key: 'extract', label: 'Extract bill of lading', status: 'not_started', plan_order: 1 }),
    classify: node({ node_key: 'classify', label: 'Check classifications', status: 'not_started', plan_order: 2 }),
  }
  const summary = getNextTaskSummary(state({ nodes }))

  assert.equal(summary.state, 'parallel')
  assert.equal(summary.label, '2 tasks ready')
  assert.deepEqual(summary.titles, ['Extract bill of lading', 'Check classifications'])
})

test('needs-human intervention reports waiting for a decision', () => {
  const summary = getNextTaskSummary(state({
    open_intervention: {
      id: 'gate',
      type: 'steer',
      node_key: 'decide',
      prompt: 'Choose route',
      requested_at: '2026-08-29T00:00:00Z',
      options: [],
    },
  }))

  assert.equal(summary.state, 'human')
  assert.deepEqual(summary.titles, ['Waiting for your decision'])
  assert.deepEqual(summary.nodeKeys, ['decide'])
})

test('completed run reports no tasks remaining', () => {
  const summary = getNextTaskSummary(state({
    runStatus: 'finished',
    nodes: { done: node({ node_key: 'done', label: 'Done', status: 'succeeded' }) },
  }))

  assert.equal(summary.state, 'complete')
  assert.deepEqual(summary.titles, ['No tasks remaining'])
})

test('connecting or empty graph reports waiting for activity', () => {
  const summary = getNextTaskSummary(state())

  assert.equal(summary.state, 'waiting')
  assert.deepEqual(summary.titles, ['Waiting for activity'])
})

test('completed nodes are never selected as next', () => {
  const summary = getNextTaskSummary(state({
    nodes: {
      done: node({ node_key: 'done', label: 'Already done', status: 'succeeded', plan_order: 1 }),
      next: node({ node_key: 'next', label: 'Do this next', status: 'not_started', plan_order: 2 }),
    },
  }))

  assert.deepEqual(summary.nodeKeys, ['next'])
})

test('dependencies are respected before a node is ready', () => {
  const nodes = {
    first: node({ node_key: 'first', label: 'First step', status: 'not_started', plan_order: 1 }),
    second: node({ node_key: 'second', label: 'Second step', status: 'not_started', plan_order: 2 }),
  }
  const summary = getNextTaskSummary(state({ nodes, edges: { one: edge('first', 'second') } }))

  assert.deepEqual(summary.nodeKeys, ['first'])
  assert.deepEqual(summary.titles, ['First step'])
})

test('next task derivation does not mutate graph state', () => {
  const nodes = {
    first: node({ node_key: 'first', label: 'First step', status: 'succeeded', plan_order: 1 }),
    second: node({ node_key: 'second', label: 'Second step', status: 'not_started', plan_order: 2 }),
  }
  const edges = { one: edge('first', 'second') }
  const before = JSON.stringify({ nodes, edges })

  getNextTaskSummary(state({ nodes, edges }))

  assert.equal(JSON.stringify({ nodes, edges }), before)
})
