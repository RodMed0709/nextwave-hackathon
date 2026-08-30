import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completeRobotMotionCue,
  createRobotMotionQueue,
  deriveRobotMotion,
  enqueueRobotMotionCue,
  getNodeTravelAnchors,
  selectJoinPredecessor,
  type RobotMotionCue,
} from '../../lib/donald/motion'
import type { DonaldEvent, RunEdge, RunNode } from '../../lib/donald/types'

function event(
  sequence: number,
  eventType: string,
  nodeKey: string | null,
  payload: Record<string, unknown> = {},
  idempotencyKey = `event-${sequence}`,
): DonaldEvent {
  return {
    sequence,
    event_type: eventType,
    occurred_at: `2026-08-29T11:20:${String(sequence).padStart(2, '0')}Z`,
    agent_label: nodeKey ? 'Nina' : null,
    node_key: nodeKey,
    idempotency_key: idempotencyKey,
    payload,
  }
}

function node(nodeKey: string, status: RunNode['status'], planOrder: number): RunNode {
  return {
    node_key: nodeKey,
    label: nodeKey,
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

function edge(edgeKey: string, source: string, target: string): RunEdge {
  return {
    edge_key: edgeKey,
    source_node_key: source,
    target_node_key: target,
    status: 'pending',
    planned: true,
  }
}

function cue(key: string): RobotMotionCue {
  return {
    key,
    targetNodeKey: 'target',
    previousNodeKey: null,
    activity: 'work.generic',
    phase: 'started',
    object: null,
    copy: null,
    metric: null,
    tone: 'active',
  }
}

test('the first active node places Donald without inventing a route', () => {
  const started = event(1, 'node_status_changed', 'collect', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: started,
    events: [started],
    nodes: { collect: node('collect', 'in_progress', 1) },
    edges: {},
    previousNodeKey: null,
  })

  assert.equal(result.cue.targetNodeKey, 'collect')
  assert.deepEqual(result.transition, {
    kind: 'place',
    sourceNodeKey: null,
    targetNodeKey: 'collect',
    edgeKey: null,
  })
})

test('Donald travels only over the direct real edge to the active node', () => {
  const started = event(2, 'node_status_changed', 'calculate', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: started,
    events: [started],
    nodes: {
      read: node('read', 'succeeded', 1),
      calculate: node('calculate', 'in_progress', 2),
    },
    edges: { 'read-calculate': edge('read-calculate', 'read', 'calculate') },
    previousNodeKey: 'read',
  })

  assert.deepEqual(result.transition, {
    kind: 'travel',
    sourceNodeKey: 'read',
    targetNodeKey: 'calculate',
    edgeKey: 'read-calculate',
  })
})

test('a skipped direct edge cannot produce robot travel', () => {
  const started = event(2, 'node_status_changed', 'target', { status: 'in_progress' })
  const skippedEdge = edge('source-target', 'source', 'target')
  skippedEdge.status = 'skipped'
  const result = deriveRobotMotion({
    event: started,
    events: [started],
    nodes: {
      source: node('source', 'succeeded', 1),
      target: node('target', 'in_progress', 2),
    },
    edges: { 'source-target': skippedEdge },
    previousNodeKey: 'source',
  })

  assert.deepEqual(result.transition, {
    kind: 'fade',
    sourceNodeKey: 'source',
    targetNodeKey: 'target',
    edgeKey: null,
  })
})

test('a join predecessor is the most recently sequenced real predecessor with a stable tie break', () => {
  const edges = {
    'alpha-join': edge('alpha-join', 'alpha', 'join'),
    'beta-join': edge('beta-join', 'beta', 'join'),
    'orphan-elsewhere': edge('orphan-elsewhere', 'orphan', 'elsewhere'),
  }
  const events = [
    event(4, 'node_status_changed', 'alpha', { status: 'succeeded' }),
    event(7, 'node_status_changed', 'beta', { status: 'succeeded' }),
  ]

  assert.equal(selectJoinPredecessor('join', edges, events), 'beta')
  assert.equal(selectJoinPredecessor('join', edges, [
    event(7, 'node_status_changed', 'beta', { status: 'succeeded' }),
    event(7, 'node_status_changed', 'alpha', { status: 'succeeded' }, 'alpha-same-sequence'),
  ]), 'alpha')
})

test('a skipped incoming edge cannot nominate a join predecessor', () => {
  const skippedEdge = edge('beta-join', 'beta', 'join')
  skippedEdge.status = 'skipped'
  const edges = {
    'alpha-join': edge('alpha-join', 'alpha', 'join'),
    'beta-join': skippedEdge,
  }
  const events = [
    event(4, 'node_status_changed', 'alpha', { status: 'succeeded' }),
    event(7, 'node_status_changed', 'beta', { status: 'succeeded' }),
  ]

  assert.equal(selectJoinPredecessor('join', edges, events), 'alpha')
})

test('resuming a blocked node reactivates Donald without travel', () => {
  const blocked = event(2, 'node_status_changed', 'invoice', { status: 'blocked_on_missing_data' })
  const resumed = event(3, 'node_status_changed', 'invoice', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: resumed,
    events: [blocked, resumed],
    nodes: { invoice: node('invoice', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'invoice',
  })

  assert.equal(result.cue.previousNodeKey, 'invoice')
  assert.deepEqual(result.transition, {
    kind: 'resume',
    sourceNodeKey: 'invoice',
    targetNodeKey: 'invoice',
    edgeKey: null,
  })
})

test('a later in-progress event does not replay an already consumed resume', () => {
  const blocked = event(2, 'node_status_changed', 'invoice', { status: 'blocked_on_missing_data' })
  const resumed = event(3, 'node_status_changed', 'invoice', { status: 'in_progress' })
  const progress = event(4, 'node_updated', 'invoice', { progress_percent: 35 })
  const laterInProgress = event(5, 'node_status_changed', 'invoice', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: laterInProgress,
    events: [blocked, resumed, progress, laterInProgress],
    nodes: { invoice: node('invoice', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'invoice',
  })

  assert.deepEqual(result.transition, {
    kind: 'place',
    sourceNodeKey: 'invoice',
    targetNodeKey: 'invoice',
    edgeKey: null,
  })
})

test('a missing edge fades at the truthful target instead of synthesizing travel', () => {
  const started = event(2, 'node_status_changed', 'target', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: started,
    events: [started],
    nodes: {
      source: node('source', 'succeeded', 1),
      target: node('target', 'in_progress', 2),
    },
    edges: {},
    previousNodeKey: 'source',
  })

  assert.deepEqual(result.transition, {
    kind: 'fade',
    sourceNodeKey: 'source',
    targetNodeKey: 'target',
    edgeKey: null,
  })
})

test('run completion settles success at the last truthful target', () => {
  const finished = event(9, 'run_finished', null, { status: 'finished' })
  const result = deriveRobotMotion({
    event: finished,
    events: [finished],
    nodes: { submit: node('submit', 'succeeded', 3) },
    edges: {},
    previousNodeKey: 'submit',
  })

  assert.equal(result.cue.targetNodeKey, 'submit')
  assert.equal(result.cue.tone, 'success')
  assert.equal(result.cue.phase, 'completed')
  assert.deepEqual(result.transition, {
    kind: 'complete',
    sourceNodeKey: 'submit',
    targetNodeKey: 'submit',
    edgeKey: null,
  })
})

test('parallel focus targets the in-progress node with the latest sequence', () => {
  const earlier = event(3, 'node_status_changed', 'earlier', { status: 'in_progress' })
  const latest = event(8, 'node_status_changed', 'latest', { status: 'in_progress' })
  const result = deriveRobotMotion({
    event: latest,
    events: [earlier, latest],
    nodes: {
      earlier: node('earlier', 'in_progress', 1),
      latest: node('latest', 'in_progress', 2),
    },
    edges: { 'earlier-latest': edge('earlier-latest', 'earlier', 'latest') },
    previousNodeKey: 'earlier',
  })

  assert.equal(result.cue.targetNodeKey, 'latest')
})

test('a node-scoped block targets that node while another node remains active', () => {
  const active = event(7, 'node_status_changed', 'active', { status: 'in_progress' })
  const blocked = event(8, 'node_status_changed', 'blocked', { status: 'blocked_on_missing_data' })
  const result = deriveRobotMotion({
    event: blocked,
    events: [active, blocked],
    nodes: {
      active: node('active', 'in_progress', 1),
      blocked: node('blocked', 'blocked_on_missing_data', 2),
    },
    edges: { 'active-blocked': edge('active-blocked', 'active', 'blocked') },
    previousNodeKey: 'active',
  })

  assert.equal(result.cue.targetNodeKey, 'blocked')
  assert.equal(result.cue.tone, 'waiting')
  assert.deepEqual(result.transition, {
    kind: 'travel',
    sourceNodeKey: 'active',
    targetNodeKey: 'blocked',
    edgeKey: 'active-blocked',
  })
})

test('explicit document and message activity cues preserve their literal semantics', () => {
  const documentEvent = event(1, 'node_updated', 'read', {
    activity: {
      kind: 'document.read',
      phase: 'progress',
      object: { kind: 'document', label: 'Commercial invoice' },
      copy: 'Reading the commercial invoice',
    },
  })
  const messageEvent = event(2, 'node_updated', 'send', {
    activity: {
      kind: 'message.send',
      phase: 'started',
      object: { kind: 'email', label: 'Invoice request' },
      copy: 'Preparing the invoice request',
    },
  })

  const documentMotion = deriveRobotMotion({
    event: documentEvent,
    events: [documentEvent],
    nodes: { read: node('read', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'read',
  })
  const messageMotion = deriveRobotMotion({
    event: messageEvent,
    events: [messageEvent],
    nodes: { send: node('send', 'in_progress', 2) },
    edges: {},
    previousNodeKey: 'send',
  })

  assert.deepEqual(documentMotion.cue, {
    key: 'event-1',
    targetNodeKey: 'read',
    previousNodeKey: 'read',
    activity: 'document.read',
    phase: 'progress',
    object: { kind: 'document', label: 'Commercial invoice' },
    copy: 'Reading the commercial invoice',
    metric: null,
    tone: 'active',
  })
  assert.equal(messageMotion.cue.activity, 'message.send')
  assert.deepEqual(messageMotion.cue.object, { kind: 'email', label: 'Invoice request' })
})

test('a typed currency metric keeps its exact numeric value and code', () => {
  const calculated = event(4, 'node_updated', 'calculate', {
    activity: { kind: 'calculate', phase: 'completed' },
    metric: { kind: 'currency', value: 15765.25, currency: 'USD', label: 'Duties and fees' },
  })
  const result = deriveRobotMotion({
    event: calculated,
    events: [calculated],
    nodes: { calculate: node('calculate', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'calculate',
  })

  assert.deepEqual(result.cue.metric, {
    kind: 'currency',
    value: 15765.25,
    currency: 'USD',
    label: 'Duties and fees',
  })
})

test('plain agent copy cannot trigger document email or currency semantics', () => {
  const message = event(5, 'agent_message', 'work', {
    message: 'Read the invoice, send an email, and show $15,765 USD.',
    estimated_cost_usd: 15765,
  })
  const result = deriveRobotMotion({
    event: message,
    events: [message],
    nodes: { work: node('work', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'work',
  })

  assert.equal(result.cue.activity, 'work.generic')
  assert.equal(result.cue.metric, null)
  assert.equal(result.cue.copy, null)
})

test('unknown or malformed explicit cues degrade safely to generic work', () => {
  const unknown = event(6, 'node_updated', 'work', {
    activity: { kind: 'document.shred', copy: 'Destroying evidence' },
    metric: { kind: 'currency', value: 12, currency: 'usd', label: 'Unsafe code' },
  })
  const result = deriveRobotMotion({
    event: unknown,
    events: [unknown],
    nodes: { work: node('work', 'in_progress', 1) },
    edges: {},
    previousNodeKey: 'work',
  })

  assert.equal(result.cue.activity, 'work.generic')
  assert.equal(result.cue.copy, null)
  assert.equal(result.cue.metric, null)
})

test('duplicate cue keys never replay', () => {
  const first = enqueueRobotMotionCue(createRobotMotionQueue(), cue('same-key'), 1)
  const duplicate = enqueueRobotMotionCue(first, cue('same-key'), 1)

  assert.equal(duplicate, first)
  assert.equal(duplicate.inFlight?.key, 'same-key')
  assert.equal(duplicate.pending, null)
})

test('the queue holds one in-flight cue and replaces its single pending cue with the newest', () => {
  let queue = createRobotMotionQueue()
  queue = enqueueRobotMotionCue(queue, cue('first'), 1)
  queue = enqueueRobotMotionCue(queue, cue('stale-pending'), 2)
  queue = enqueueRobotMotionCue(queue, cue('newest-pending'), 3)

  assert.equal(queue.inFlight?.key, 'first')
  assert.equal(queue.pending?.key, 'newest-pending')
  assert.equal(queue.lastSequence, 3)

  const promoted = completeRobotMotionCue(queue, 'first')
  assert.equal(promoted.inFlight?.key, 'newest-pending')
  assert.equal(promoted.pending, null)
})

test('presentation remains one in-flight plus one pending during an event burst', () => {
  let queue = createRobotMotionQueue()
  for (let index = 0; index < 80; index += 1) {
    queue = enqueueRobotMotionCue(queue, cue(`event-${index}`), index + 1)
  }

  assert.equal(queue.inFlight?.key, 'event-0')
  assert.equal(queue.pending?.key, 'event-79')
})

test('a completed event never replays after more than 64 newer reducer-accepted sequences', () => {
  let queue = enqueueRobotMotionCue(createRobotMotionQueue(), cue('original'), 1)
  queue = completeRobotMotionCue(queue, 'original')
  for (let index = 0; index < 65; index += 1) {
    const key = `newer-${index}`
    queue = enqueueRobotMotionCue(queue, cue(key), index + 2)
    queue = completeRobotMotionCue(queue, key)
  }

  const replay = enqueueRobotMotionCue(queue, cue('original'), 1)

  assert.equal(replay, queue)
  assert.equal(replay.inFlight, null)
  assert.equal(replay.pending, null)
})

test('reducer sequence high-water accepts the current event once without retaining every key', () => {
  const beforeCurrentEvent = createRobotMotionQueue(64)
  const current = enqueueRobotMotionCue(beforeCurrentEvent, cue('current-event'), 65)

  assert.equal(current.inFlight?.key, 'current-event')
  assert.equal(current.lastSequence, 65)

  const settled = completeRobotMotionCue(current, 'current-event')
  const replay = enqueueRobotMotionCue(settled, cue('current-event'), 65)

  assert.equal(replay, settled)
  assert.deepEqual(Object.keys(replay).sort(), ['inFlight', 'lastSequence', 'pending'])
})

test('travel anchors use the source right-center and target left-center from actual card sizes', () => {
  const anchors = getNodeTravelAnchors(
    'source',
    'target',
    {
      source: { x: 40, y: 100, depth: 0 },
      target: { x: 500, y: 280, depth: 1 },
    },
    {
      source: { width: 320, height: 180 },
      target: { width: 430, height: 510 },
    },
  )

  assert.deepEqual(anchors, {
    source: { x: 360, y: 190 },
    target: { x: 500, y: 535 },
  })
})
