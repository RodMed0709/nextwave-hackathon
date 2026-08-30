import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ACTION_PRESENTATIONS,
  DONALD_ACTION_IDS,
  actionPresentationForNode,
  decisionOptionPresentation,
  donaldActionIdForNode,
  type DonaldActionId,
} from '../../lib/donald/action-presentation'
import { ACTION_ANIMATION_REGISTRY, getActionAnimationSpec } from '../../components/donald/animations/action-animation-registry'

const RECORDED_FIXTURES = [
  'events.berrios-op4471.jsonl',
  'events.land-pickup.jsonl',
  'events.missing-invoice.jsonl',
  'events.replan.jsonl',
] as const

const RECORDED_ACTION_IDS: Record<string, DonaldActionId | null> = {
  act_book_alternate: 'act',
  act_confirm_arrival: 'act',
  ambient_identify: 'identify',
  ambient_ingest: 'ingest',
  ambient_monitor: 'monitor',
  brief_boss_email: null,
  calculate_duties: 'impact',
  confirm_booking: 'act',
  calculate_exposure: 'impact',
  check_product_classifications: null,
  decide_response: 'decide',
  detect_capacity_conflict: 'detect',
  detect_schedule_change: 'detect',
  establish_customs_value: null,
  explain_change: 'explain',
  explain_root_cause: 'explain',
  extract_bl: 'extract',
  extract_response_terms: 'extract',
  extract_second_leg_bl: 'extract',
  file_customs_entry: null,
  find_commercial_invoice: null,
  identify_booking: 'identify',
  identify_operation: 'identify',
  identify_po: 'identify',
  ingest_arrival_notice: 'ingest',
  ingest_asn: 'ingest',
  ingest_capacity_response: 'ingest',
  monitor_eta: 'monitor',
  monitor_free_time_clock: 'monitor',
  obtain_missing_invoice: null,
  plan_options: 'plan',
  plan_responses: 'plan',
  predict_overrun: 'predict',
  quantify_impact: 'impact',
  recompute_eta: null,
  reconcile_booking: 'reconcile',
  reconcile_free_time: 'reconcile',
  reconcile_routing: 'reconcile',
  update_client_email: 'act',
}

test('action presentation registry defines every canonical Donald action', () => {
  assert.equal(DONALD_ACTION_IDS.length, 12)

  for (const actionId of DONALD_ACTION_IDS) {
    const presentation = ACTION_PRESENTATIONS[actionId]
    assert.equal(presentation.id, actionId)
    assert.equal(presentation.petAsset, `/pets/${actionId}-pet.png`)
    assert.equal(presentation.animationKind, actionId)
  }
})

test('action presentation resolves canonical node-key prefixes', () => {
  assert.equal(actionPresentationForNode({ nodeKey: 'ingest_capacity_response', label: 'Read response' }).id, 'ingest')
  assert.equal(actionPresentationForNode({ nodeKey: 'act_book_alternate', label: 'Book alternate carrier' }).id, 'act')
})

test('action presentation resolves semantic aliases from current recordings', () => {
  assert.equal(actionPresentationForNode({ nodeKey: 'calculate_exposure', label: 'Quantify the exposure' }).id, 'impact')
  assert.equal(actionPresentationForNode({ nodeKey: 'receive-update', label: 'Review carrier update' }).id, 'ingest')
})

test('email steps keep the act id but get the email scene', () => {
  const presentation = actionPresentationForNode({
    nodeKey: 'brief_boss_email',
    label: 'Communicating the news to the boss',
  })
  assert.equal(presentation.id, 'act')
  assert.equal(presentation.animationKind, 'email')
  assert.equal(presentation.label, 'Email')

  // Non-email act steps keep the execute scene.
  assert.equal(actionPresentationForNode({ nodeKey: 'act_book_alternate', label: 'Book alternate carrier' }).animationKind, 'act')
})

test('decision options reduce operational copy to price and one short consequence', () => {
  assert.deepEqual(decisionOptionPresentation({
    id: 'alternative-routing',
    label: 'Re-book MSC ILONA FE2440 - direct San Juan, ETA Oct 3, $0',
    rationale: 'Recovers four days and protects the committed delivery.',
    rank: 1,
    maximum_cost_usd: 0,
    client_commitment: null,
    document: null,
  }), {
    price: '$0',
    consequence: 'direct San Juan, ETA Oct 3',
    tooltip: 'Recovers four days and protects the committed delivery.',
  })

  assert.deepEqual(decisionOptionPresentation({
    id: 'premium-transload',
    label: 'Transload at Caucedo onto a feeder - ETA Oct 1, +$2,400',
    rationale: 'Two days faster, but adds handling risk.',
    rank: 2,
    maximum_cost_usd: 2400,
    client_commitment: null,
    document: null,
  }), {
    price: '+$2,400',
    consequence: 'ETA Oct 1',
    tooltip: 'Two days faster, but adds handling risk.',
  })
})

test('decision options show operational ETA deltas, never absolute dates, when the gate allows comparison', () => {
  const rebook = {
    id: 'alternative-routing',
    label: 'Re-book MSC ILONA FE2440 - direct San Juan, ETA Oct 3, $0',
    rationale: null,
    rank: 1,
    maximum_cost_usd: 0,
    client_commitment: null,
    document: null,
  }
  const transload = {
    id: 'premium-transload',
    label: 'Transload at Caucedo onto a feeder - ETA Oct 1, +$2,400',
    rationale: null,
    rank: 2,
    maximum_cost_usd: 2400,
    client_commitment: null,
    document: null,
  }
  const fallback = {
    id: 'accept-fallback',
    label: "Accept the carrier's fallback - ETA Oct 7, notify only",
    rationale: null,
    rank: 3,
    maximum_cost_usd: 0,
    client_commitment: null,
    document: null,
  }
  const gate = [rebook, transload, fallback]

  assert.equal(decisionOptionPresentation(transload, gate).consequence, 'same day')
  assert.equal(decisionOptionPresentation(rebook, gate).consequence, 'direct San Juan, +2 days')
  assert.equal(decisionOptionPresentation(fallback, gate).consequence, '+6 days, notify only')
  // The price stays the big lead of the "PRICE -> consequence" format.
  assert.equal(decisionOptionPresentation(transload, gate).price, '+$2,400')
})


test('every canonical Donald action has one SVG Repo card icon registered', () => {
  for (const actionId of DONALD_ACTION_IDS) {
    const spec = ACTION_ANIMATION_REGISTRY[actionId]
    assert.equal(spec.kind, actionId)
    assert.equal(spec.className, `action-animation-${actionId}`)
    assert.match(spec.iconUrl, /^https:\/\/www\.svgrepo\.com\/show\//)
    assert.match(spec.iconUrl, /\.svg$/)
  }
})

test('unknown animation kind gracefully uses the default animation', () => {
  assert.deepEqual(getActionAnimationSpec('unknown' as never), ACTION_ANIMATION_REGISTRY.default)
})
test('action presentation keeps words visible across joined metadata fields', () => {
  assert.equal(
    donaldActionIdForNode({ nodeKey: 'analyze_cause', label: 'Explain the carrier change' }),
    'explain',
  )
  assert.equal(
    donaldActionIdForNode({ nodeKey: 'investigate_cause', label: 'Carrier changed the route' }),
    'explain',
  )
})

test('action presentation resolves the vocabulary emitted by free-form OpenAI runs', () => {
  const cases: Array<[string, DonaldActionId]> = [
    ['assess_financial_implications', 'impact'],
    ['propose_options', 'plan'],
    ['check_for_updates', 'monitor'],
    ['review_existing_schedule', 'reconcile'],
  ]

  for (const [nodeKey, expected] of cases) {
    assert.equal(donaldActionIdForNode({ nodeKey, label: 'Free-form agent step' }), expected)
  }
})

test('action presentation tolerates simple plural keyword forms', () => {
  const cases: Array<[string, DonaldActionId]> = [
    ['status_updates', 'monitor'],
    ['business_implications', 'impact'],
    ['candidate_options', 'plan'],
  ]

  for (const [nodeKey, expected] of cases) {
    assert.equal(donaldActionIdForNode({ nodeKey, label: 'Free-form agent step' }), expected)
  }
})

test('unmatched work uses the neutral action presentation', () => {
  const presentation = actionPresentationForNode({
    nodeKey: 'coordinate_special_handling',
    label: 'Coordinate special handling',
  })

  assert.equal(presentation.id, 'default')
  assert.equal(presentation.label, 'Work')
  assert.equal(presentation.petAsset, '/donald_favicon.png')
  assert.equal(presentation.animationKind, 'default')
})

test('recorded fixture node keys retain their pre-change action classifications', () => {
  const labels = new Map<string, string>()

  for (const fixture of RECORDED_FIXTURES) {
    const events = readFileSync(`lib/donald/${fixture}`, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as {
        event_type: string
        node_key: string | null
        payload: { label?: unknown }
      })

    for (const event of events) {
      if (!event.node_key) continue
      const label = event.event_type === 'node_added' && typeof event.payload.label === 'string'
        ? event.payload.label
        : labels.get(event.node_key) ?? ''
      labels.set(event.node_key, label)
    }
  }

  assert.deepEqual([...labels.keys()].sort(), Object.keys(RECORDED_ACTION_IDS).sort())
  for (const [nodeKey, label] of labels) {
    assert.equal(
      donaldActionIdForNode({ nodeKey, label }),
      RECORDED_ACTION_IDS[nodeKey],
      nodeKey,
    )
  }
})
