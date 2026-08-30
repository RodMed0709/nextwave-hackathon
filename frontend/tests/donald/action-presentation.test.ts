import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTION_PRESENTATIONS,
  DONALD_ACTION_IDS,
  actionPresentationForNode,
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
