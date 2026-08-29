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

test('a declared plan materialises its nodes AND its edges', () => {
  // Donald declares a plan as ONE event rather than a burst of node_added /
  // edge_added. Reading only the summary left the graph with no edges, so every
  // run rendered as a straight line whatever shape the agent declared — the
  // fan-outs and joins were in the payload and dropped on the floor.
  const state = applyEvent(createInitialRunState('run-1'), {
    sequence: 2,
    event_type: 'plan_declared',
    occurred_at: '2026-08-29T11:20:00Z',
    agent_label: null,
    node_key: null,
    idempotency_key: 'plan',
    payload: {
      plan: {
        steps: [
          { node_key: 'a', label: 'Ingest', agent_label: 'Nina', planned: true, plan_order: 1 },
          { node_key: 'b', label: 'Extract', agent_label: 'Theo', planned: true, plan_order: 2 },
          { node_key: 'c', label: 'Reconcile', agent_label: 'Theo', planned: true, plan_order: 3 },
        ],
        edges: [
          { edge_key: 'a->b', source_node_key: 'a', target_node_key: 'b' },
          { edge_key: 'a->c', source_node_key: 'a', target_node_key: 'c' },
          { edge_key: 'b->c', source_node_key: 'b', target_node_key: 'c' },
        ],
      },
    },
  })

  assert.deepEqual(Object.keys(state.nodes).sort(), ['a', 'b', 'c'])
  assert.equal(state.nodes.a.label, 'Ingest')
  // agent_label drives the swimlanes; it comes off the step, not the event.
  assert.equal(state.nodes.b.agent_label, 'Theo')
  assert.equal(state.nodes.c.plan_order, 3)

  // The join is the point: 'c' waits on both 'a' and 'b'.
  assert.deepEqual(Object.keys(state.edges).sort(), ['a->b', 'a->c', 'b->c'])
  const intoC = Object.values(state.edges).filter((edge) => edge.target_node_key === 'c')
  assert.equal(intoC.length, 2, 'c is a join and must keep both incoming edges')
})

test('a plan declaration does not clobber a node that already reported', () => {
  let state = createInitialRunState('run-1')
  state = applyEvent(state, {
    sequence: 1,
    event_type: 'node_status_changed',
    occurred_at: '2026-08-29T11:20:00Z',
    agent_label: 'Nina',
    node_key: 'a',
    idempotency_key: 'start-a',
    payload: { status: 'in_progress' },
  })
  state = applyEvent(state, {
    sequence: 2,
    event_type: 'plan_declared',
    occurred_at: '2026-08-29T11:20:01Z',
    agent_label: null,
    node_key: null,
    idempotency_key: 'plan',
    payload: { plan: { steps: [{ node_key: 'a', label: 'Ingest', plan_order: 1 }], edges: [] } },
  })

  // Out-of-order arrival must not reset progress to not_started.
  assert.equal(state.nodes.a.status, 'in_progress')
  assert.equal(state.nodes.a.label, 'Ingest')
})
