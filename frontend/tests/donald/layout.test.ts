import assert from 'node:assert/strict'
import test from 'node:test'
import { getLayoutBounds, layoutGraph } from '../../lib/donald/layout'
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
    beta: { x: 388, y: 330, depth: 1 },
  })

  assert.deepEqual(bounds, { x: 48, y: 100, width: 612, height: 430 })
})
