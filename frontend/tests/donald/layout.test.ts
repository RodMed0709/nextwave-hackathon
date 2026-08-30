import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_GAP, getCombinedLayoutBounds, getFitViewport, getFocusedNodeViewport, getLayoutBounds, getVisibleNodeViewport, layoutGraph } from '../../lib/donald/layout'
import type { RunEdge, RunNode } from '../../lib/donald/types'

function node(nodeKey: string, planOrder: number): RunNode {
  return {
    node_key: nodeKey,
    label: nodeKey,
    agent_label: 'Agent',
    status: 'not_started',
    planned: true,
    plan_order: planOrder,
    progress_percent: 0,
    estimated_seconds: null,
    started_at: null,
    finished_at: null,
    input_summary: null,
    output_summary: null,
    artifacts: [],
    description: null,
    node_type: null,
    tool_name: null,
    status_message: null,
    error_message: null,
    manual_minutes: null,
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

test('layoutGraph derives columns from longest-path depth', () => {
  const positions = layoutGraph(
    { root: node('root', 1), child: node('child', 2), leaf: node('leaf', 3) },
    { a: edge('a', 'root', 'child'), b: edge('b', 'child', 'leaf') },
  )

  assert.ok(positions.root.x < positions.child.x)
  assert.ok(positions.child.x < positions.leaf.x)
  assert.equal(positions.child.x - positions.root.x, 464)
  assert.equal(positions.leaf.x - positions.child.x, 464)
  assert.equal(positions.root.depth, 0)
  assert.equal(positions.leaf.depth, 2)
})

test('siblings recenter when nodes appear and close the gap after removal', () => {
  const initialNodes = { root: node('root', 1), alpha: node('alpha', 2), beta: node('beta', 3) }
  const initialEdges = { a: edge('a', 'root', 'alpha'), b: edge('b', 'root', 'beta') }
  const before = layoutGraph(initialNodes, initialEdges)
  const after = layoutGraph(
    { ...initialNodes, gamma: node('gamma', 4) },
    { ...initialEdges, c: edge('c', 'root', 'gamma') },
    before,
  )

  assert.notEqual(after.alpha.y, before.alpha.y)
  assert.notEqual(after.beta.y, before.beta.y)
  assert.ok(after.gamma)
  assert.equal(after.beta.y - after.alpha.y, 290)
  assert.equal(after.gamma.y - after.beta.y, 290)
  assert.equal((after.alpha.y + after.beta.y + after.gamma.y) / 3, 280)

  const closed = layoutGraph(
    { root: initialNodes.root, beta: initialNodes.beta, gamma: node('gamma', 4) },
    { b: initialEdges.b, c: edge('c', 'root', 'gamma') },
    after,
  )
  assert.equal((closed.beta.y + closed.gamma.y) / 2, 280)
  assert.notEqual(closed.beta.y, after.beta.y)
})

test('getLayoutBounds covers every authored-by-layout node card', () => {
  const bounds = getLayoutBounds({
    alpha: { x: 48, y: 100, depth: 0 },
    beta: { x: 512, y: 330, depth: 1 },
  })

  assert.deepEqual(bounds, { x: 48, y: 100, width: 844, height: 460 })
})

test('layoutGraph leaves a minimum gap around an expanded card', () => {
  const nodes = {
    root: node('root', 1),
    alpha: node('alpha', 2),
    beta: node('beta', 3),
    leaf: node('leaf', 4),
  }
  const positions = layoutGraph(
    nodes,
    {
      a: edge('a', 'root', 'alpha'),
      b: edge('b', 'root', 'beta'),
      c: edge('c', 'alpha', 'leaf'),
    },
    {},
    {
      root: { width: 380, height: 230 },
      alpha: { width: 540, height: 640 },
      beta: { width: 380, height: 230 },
      leaf: { width: 380, height: 230 },
    },
  )

  assert.ok(positions.alpha.y + 640 + CARD_GAP <= positions.beta.y)
  assert.ok(positions.root.x + 380 + CARD_GAP <= positions.alpha.x)
  assert.ok(positions.alpha.x + 540 + CARD_GAP <= positions.leaf.x)
})

test('removed nodes retain their graph depth and participate in packing', () => {
  const removed = node('removed', 2)
  removed.removed = true
  const positions = layoutGraph(
    { root: node('root', 1), removed, replacement: node('replacement', 3) },
    { replacement: edge('replacement', 'root', 'replacement') },
    { removed: { x: 388, y: 280, depth: 1 } },
    {
      root: { width: 380, height: 230 },
      removed: { width: 380, height: 330 },
      replacement: { width: 380, height: 230 },
    },
  )

  assert.equal(positions.removed.depth, 1)
  assert.equal(positions.replacement.depth, 1)
  assert.ok(positions.removed.y + 330 + CARD_GAP <= positions.replacement.y)
})

test('getLayoutBounds uses the rendered size of each card', () => {
  const bounds = getLayoutBounds(
    {
      alpha: { x: 48, y: 100, depth: 0 },
      beta: { x: 420, y: 220, depth: 1 },
    },
    {
      alpha: { width: 300, height: 176 },
      beta: { width: 430, height: 510 },
    },
  )

  assert.deepEqual(bounds, { x: 48, y: 100, width: 802, height: 630 })
})

test('getFitViewport uses eight percent total breathing room', () => {
  const viewport = getFitViewport(
    { x: 0, y: 0, width: 1_000, height: 500 },
    { width: 1_000, height: 600 },
  )

  assert.deepEqual(viewport, { x: 40, y: 70, zoom: 0.92 })
})

test('getFitViewport caps a small graph at 1.35x', () => {
  const viewport = getFitViewport(
    { x: 0, y: 0, width: 380, height: 230 },
    { width: 1_200, height: 800 },
  )

  assert.deepEqual(viewport, { x: 343.5, y: 244.75, zoom: 1.35 })
})

test('getVisibleNodeViewport reduces zoom when the drawer leaves too little room', () => {
  const viewport = getVisibleNodeViewport(
    { x: 100, y: 100 },
    { width: 380, height: 230 },
    { x: -111, y: 20, zoom: 1.35 },
    { width: 960, height: 600 },
    { top: 24, right: 454, bottom: 24, left: 24 },
  )
  const left = 100 * viewport.zoom + viewport.x
  const right = left + 380 * viewport.zoom

  assert.ok(Math.abs(viewport.zoom - 482 / 380) < 1e-12)
  assert.ok(Math.abs(left - 24) < 1e-9)
  assert.ok(Math.abs(right - 506) < 1e-9)
})

test('getVisibleNodeViewport preserves the camera when the drawer covers the viewport', () => {
  const current = { x: -111, y: 20, zoom: 1.35 }
  const viewport = getVisibleNodeViewport(
    { x: 100, y: 100 },
    { width: 380, height: 230 },
    current,
    { width: 390, height: 600 },
    { top: 24, right: 414, bottom: 24, left: 24 },
  )

  assert.deepEqual(viewport, current)
})


test('getFocusedNodeViewport centers the selected card at a readable zoom', () => {
  const viewport = getFocusedNodeViewport(
    { x: 512, y: 240 },
    { width: 380, height: 460 },
    { width: 1200, height: 760 },
  )

  const centerX = (512 + 190) * viewport.zoom + viewport.x
  const centerY = (240 + 230) * viewport.zoom + viewport.y
  assert.equal(Math.round(centerX), 600)
  assert.equal(Math.round(centerY), 380)
  assert.ok(viewport.zoom > 1)
})


test('getCombinedLayoutBounds covers multiple active stage bounds with padding', () => {
  const bounds = getCombinedLayoutBounds([
    { x: 48, y: 120, width: 380, height: 230 },
    null,
    { x: 48, y: 90, width: 844, height: 520 },
  ], 48)

  assert.deepEqual(bounds, { x: 0, y: 42, width: 940, height: 616 })
})

test('getFocusedNodeViewport keeps an expanded human-gate card fully visible', () => {
  const viewport = getFocusedNodeViewport(
    { x: 512, y: 160 },
    { width: 620, height: 760 },
    { width: 1180, height: 820 },
  )

  const left = 512 * viewport.zoom + viewport.x
  const top = 160 * viewport.zoom + viewport.y
  const right = left + 620 * viewport.zoom
  const bottom = top + 760 * viewport.zoom
  assert.ok(left >= 40)
  assert.ok(right <= 1140)
  assert.ok(top >= 40)
  assert.ok(bottom <= 780)
})
