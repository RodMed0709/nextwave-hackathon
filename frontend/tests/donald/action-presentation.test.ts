import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTION_PRESENTATIONS,
  DONALD_ACTION_IDS,
  actionPresentationForNode,
  decisionOptionPresentation,
} from '../../lib/donald/action-presentation'

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
