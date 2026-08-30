import assert from 'node:assert/strict'
import test from 'node:test'
import { pickSteerTargetKey } from '../../lib/donald/steer-target'
import type { OpenIntervention, RunNode } from '../../lib/donald/types'

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

const intervention: OpenIntervention = {
  id: 'iv-1',
  type: 'decision',
  node_key: 'decide_gate',
  prompt: 'Which option?',
  requested_at: '2026-08-30T00:00:00Z',
  options: [],
}

test('an open intervention always wins', () => {
  const nodes = {
    decide_gate: node({ node_key: 'decide_gate', label: 'Decide', status: 'blocked_on_user_decision' }),
    act_book: node({ node_key: 'act_book', label: 'Book', status: 'in_progress' }),
  }
  const target = pickSteerTargetKey({ nodes, open_intervention: intervention }, ['act_book'], ['act_book'])
  assert.equal(target, 'decide_gate')
})

test('falls through next-task, then visibly active, then any steerable node', () => {
  const nodes = {
    done: node({ node_key: 'done', label: 'Done', status: 'succeeded' }),
    running: node({ node_key: 'running', label: 'Running', status: 'in_progress' }),
    queued: node({ node_key: 'queued', label: 'Queued', status: 'not_started' }),
  }
  assert.equal(pickSteerTargetKey({ nodes, open_intervention: null }, ['queued'], ['running']), 'queued')
  assert.equal(pickSteerTargetKey({ nodes, open_intervention: null }, ['done'], ['running']), 'running')
  assert.equal(pickSteerTargetKey({ nodes, open_intervention: null }, [], []), 'running')
})

test('a finished run still accepts a message on its last step', () => {
  const nodes = {
    first: node({ node_key: 'first', label: 'First', status: 'succeeded' }),
    last: node({ node_key: 'last', label: 'Last', status: 'succeeded' }),
    gone: node({ node_key: 'gone', label: 'Gone', status: 'in_progress', removed: true }),
  }
  assert.equal(pickSteerTargetKey({ nodes, open_intervention: null }, [], []), 'last')
})

test('an empty run has nothing to steer', () => {
  assert.equal(pickSteerTargetKey({ nodes: {}, open_intervention: null }, [], []), null)
})
