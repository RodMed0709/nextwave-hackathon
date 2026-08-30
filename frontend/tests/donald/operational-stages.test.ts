import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientProjectMetadata,
  operationalStageForNode,
  summarizeOperationalStages,
} from '../../lib/donald/operational-stages'
import type { DonaldEvent, RunNode } from '../../lib/donald/types'

function node(overrides: Partial<RunNode> & { node_key: string; label: string }): RunNode {
  return {
    node_key: overrides.node_key,
    label: overrides.label,
    agent_label: overrides.agent_label ?? null,
    status: overrides.status ?? 'not_started',
    planned: true,
    plan_order: null,
    progress_percent: 0,
    estimated_seconds: null,
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: overrides.output_summary ?? null,
    artifacts: [],
    removed: overrides.removed ?? false,
    description: overrides.description ?? null,
    node_type: overrides.node_type ?? null,
    tool_name: overrides.tool_name ?? null,
    status_message: null,
    error_message: null,
    manual_minutes: null,
  }
}

test('operational stage mapping groups ambient actions above the line', () => {
  assert.equal(operationalStageForNode(node({ node_key: 'ingest-carrier-update', label: 'Review carrier update' })), 'above')
  assert.equal(operationalStageForNode(node({ node_key: 'identify-shipment', label: 'Match update to shipment' })), 'above')
  assert.equal(operationalStageForNode(node({ node_key: 'monitor_free_time_clock', label: 'Track the free-time clock' })), 'above')
})

test('operational stage mapping groups targeted response actions below the line', () => {
  assert.equal(operationalStageForNode(node({ node_key: 'predict-delay-risk', label: 'Forecast downstream delay' })), 'below')
  assert.equal(operationalStageForNode(node({ node_key: 'detect-freight-anomaly', label: 'Flag freight anomaly' })), 'below')
  assert.equal(operationalStageForNode(node({ node_key: 'reconcile-booking', label: 'Reconcile with booking' })), 'below')
  assert.equal(operationalStageForNode(node({ node_key: 'decide_response', label: 'Decide the response' })), 'below')
  assert.equal(operationalStageForNode(node({ node_key: 'act_book_alternate', label: 'Book alternate carrier' })), 'below')
})

test('operational stage mapping leaves unknown actions unclassified', () => {
  assert.equal(operationalStageForNode(node({ node_key: 'audit-customs-documents', label: 'Audit customs documents' })), 'unclassified')
})

test('operational stage summaries count only active non-removed actions', () => {
  const summaries = summarizeOperationalStages({
    ambientDone: node({ node_key: 'ingest-update', label: 'Ingest update', status: 'succeeded', agent_label: 'Nina' }),
    ambientRunning: node({ node_key: 'monitor-vessel', label: 'Monitor vessel', status: 'in_progress', agent_label: 'Nina' }),
    removed: node({ node_key: 'notify-client', label: 'Inform the customer', status: 'not_started', removed: true, agent_label: 'Nina' }),
    decision: node({ node_key: 'decide_response', label: 'Decide the response', status: 'blocked_on_user_decision' }),
  })

  const above = summaries.find((stage) => stage.id === 'above')
  const below = summaries.find((stage) => stage.id === 'below')

  assert.equal(above?.state, 'in-progress')
  assert.equal(above?.completeActions, 1)
  assert.equal(above?.totalActions, 2)
  assert.equal(below?.state, 'needs-human')
  assert.equal(below?.completeActions, 0)
  assert.equal(below?.totalActions, 1)
})

test('client project metadata reads only existing event metadata', () => {
  const event: DonaldEvent = {
    sequence: 1,
    event_type: 'run_started',
    occurred_at: '2026-08-29T11:20:00Z',
    agent_label: null,
    node_key: null,
    idempotency_key: 'run',
    payload: {
      client_name: 'Muebles del Sur',
      industry: 'Furniture imports',
      agents: [{ label: 'Nina', role: 'Shipment Watch' }],
    },
  }

  assert.deepEqual(clientProjectMetadata([event], 'Resolve shipment delay'), {
    clientName: 'Muebles del Sur',
    business: 'Furniture imports',
    projectGoal: 'Resolve shipment delay',
    agents: [{ label: 'Nina', role: 'Shipment Watch' }],
  })
})
