import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTION_PRESENTATIONS,
  DONALD_ACTION_IDS,
  actionPresentationForNode,
  decisionOptionPresentation,
} from '../../lib/donald/action-presentation'
import { ACTION_ANIMATION_REGISTRY, getActionAnimationSpec } from '../../components/donald/animations/action-animation-registry'

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

  assert.equal(decisionOptionPresentation(transload, gate).consequence, 'ETA same day')
  assert.equal(decisionOptionPresentation(rebook, gate).consequence, 'direct San Juan, ETA +2 days')
  assert.equal(decisionOptionPresentation(fallback, gate).consequence, 'ETA +6 days, notify only')
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
