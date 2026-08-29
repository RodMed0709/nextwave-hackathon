import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { applyEvent, applyEvents, createInitialRunState } from '../../lib/donald/reduce'
import { isDonaldEvent, type DonaldEvent } from '../../lib/donald/types'

function event(
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
  nodeKey: string | null = null,
): DonaldEvent {
  return {
    sequence,
    event_type: eventType,
    occurred_at: `2026-08-29T11:20:${String(sequence).padStart(2, '0')}+00:00`,
    agent_label: nodeKey ? 'Nina' : null,
    node_key: nodeKey,
    idempotency_key: `event-${sequence}`,
    payload,
  }
}

test('applyEvents sorts events before folding and ignores duplicate idempotency keys', () => {
  const added = event(1, 'node_added', { label: 'Receive update', planned: true, plan_order: 1 }, 'receive')
  const started = event(2, 'node_status_changed', { status: 'in_progress', started_at: '2026-08-29T11:20:02+00:00' }, 'receive')

  const state = applyEvents(createInitialRunState('3482'), [started, added, started])

  assert.deepEqual(state.event_log.map((item) => item.sequence), [1, 2])
  assert.equal(state.nodes.receive.status, 'in_progress')
  assert.equal(state.nodes.receive.label, 'Receive update')
})

test('unknown events remain visible in the ordered log without throwing', () => {
  const unknown = event(1, 'provider_debugged', { detail: 'kept for forward compatibility' })
  const state = applyEvent(createInitialRunState(), unknown)

  assert.equal(state.event_log.length, 1)
  assert.equal(state.event_log[0].event_type, 'provider_debugged')
})

test('run and intervention display metadata are retained from event payloads', () => {
  const started = event(1, 'run_started', {
    run_uuid: 'OP-4471',
    name: 'Resolve the delayed OP-4471 shipment',
  })
  const requested = event(2, 'intervention_requested', {
    prompt: 'Choose the response.',
    options: [{
      id: 'secure-new-bl',
      label: 'Prioritize documentation',
      rank: 2,
      maximum_cost_usd: 3780,
      client_commitment: '10-SEP-2026',
      document: 'BL-77120',
    }],
  }, 'decide-response')

  const state = applyEvents(createInitialRunState(), [started, requested])

  assert.equal(state.run.key, 'OP-4471')
  assert.equal(state.run.name, 'Resolve the delayed OP-4471 shipment')
  assert.deepEqual(state.open_intervention?.options[0], {
    id: 'secure-new-bl',
    label: 'Prioritize documentation',
    rationale: null,
    rank: 2,
    maximum_cost_usd: 3780,
    client_commitment: '10-SEP-2026',
    document: 'BL-77120',
  })
})

test('the complete recording rewires the graph and closes the intervention', () => {
  const lines = readFileSync('lib/donald/events.recorded.jsonl', 'utf8').trim().split(/\r?\n/)
  const values: unknown[] = lines.map((line) => JSON.parse(line) as unknown)
  assert.ok(values.every(isDonaldEvent))

  const state = applyEvents(createInitialRunState('3482'), values)

  assert.equal(state.event_log.length, 80)
  assert.equal(state.run.key, 'OP-4471')
  assert.equal(state.run.name, 'Resolve the delayed OP-4471 shipment')
  assert.equal(Object.keys(state.nodes).length, 8)
  assert.equal(Object.values(state.nodes).filter((node) => !node.removed).length, 7)
  assert.equal(state.nodes['notify-client'].removed, true)
  assert.equal(state.nodes['quote-carriers'].planned, true)
  assert.equal(state.nodes['secure-new-bl'].planned, true)
  assert.equal(state.nodes['decide-response'].planned, true)
  assert.equal(state.edges['impact-to-notify'].status, 'removed')
  assert.equal(state.run.graph_revision, 2)
  assert.equal(state.run.status, 'finished')
  assert.equal(state.open_intervention, null)
  const replanIndex = values.findIndex((value) => isDonaldEvent(value) && value.event_type === 'run_updated')
  const removalIndex = values.findIndex((value) => isDonaldEvent(value) && value.event_type === 'node_removed')
  assert.ok(replanIndex < removalIndex, 'the replan event must precede its structural changes')
})
