import assert from 'node:assert/strict'
import test from 'node:test'
import { getExecutivePhases } from '../../lib/donald/executive-phases'
import type { RunNode } from '../../lib/donald/types'

function node(overrides: Partial<RunNode> & { node_key: string; label: string }): RunNode {
  return {
    node_key: overrides.node_key,
    label: overrides.label,
    agent_label: null,
    status: overrides.status ?? 'not_started',
    planned: true,
    plan_order: null,
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

test('the strip reads watch live, solve in progress, act up next', () => {
  const phases = getExecutivePhases({
    ambient_monitor: node({ node_key: 'ambient_monitor', label: 'Keep watch', status: 'succeeded' }),
    reconcile_booking: node({ node_key: 'reconcile_booking', label: 'Reconcile the booking', status: 'in_progress' }),
    update_client_email: node({ node_key: 'update_client_email', label: 'Update the client' }),
  })
  assert.deepEqual(phases.map((phase) => [phase.id, phase.state]), [
    ['watch', 'running'],
    ['solve', 'running'],
    ['act', 'waiting'],
  ])
})

test('a finished case shows solve and act done while the watch stays live', () => {
  const phases = getExecutivePhases({
    ambient_monitor: node({ node_key: 'ambient_monitor', label: 'Keep watch', status: 'succeeded' }),
    decide_response: node({ node_key: 'decide_response', label: 'Decide the response', status: 'succeeded' }),
    update_client_email: node({ node_key: 'update_client_email', label: 'Update the client', status: 'succeeded' }),
  })
  assert.deepEqual(phases.map((phase) => [phase.id, phase.state]), [
    ['watch', 'running'],
    ['solve', 'done'],
    ['act', 'done'],
  ])
})

test('a gate waiting on a person keeps solve in progress', () => {
  const phases = getExecutivePhases({
    decide_response: node({ node_key: 'decide_response', label: 'Decide the response', status: 'blocked_on_user_decision' }),
  })
  assert.equal(phases.find((phase) => phase.id === 'solve')?.state, 'running')
})
