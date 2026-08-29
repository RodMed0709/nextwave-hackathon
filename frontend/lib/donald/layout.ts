import type { RunEdge, RunNode } from './types'

export type LayoutPosition = { x: number; y: number; depth: number }
export type LayoutBounds = { x: number; y: number; width: number; height: number }

const COLUMN_GAP = 340
const ROW_GAP = 230
const ORIGIN_X = 48
const ORIGIN_Y = 280
export const NODE_WIDTH = 272
export const NODE_HEIGHT = 200

export function getLayoutBounds(positions: Record<string, LayoutPosition>): LayoutBounds | null {
  const values = Object.values(positions)
  if (values.length === 0) return null
  const left = Math.min(...values.map((position) => position.x))
  const top = Math.min(...values.map((position) => position.y))
  const right = Math.max(...values.map((position) => position.x + NODE_WIDTH))
  const bottom = Math.max(...values.map((position) => position.y + NODE_HEIGHT))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function layoutGraph(
  nodes: Record<string, RunNode>,
  edges: Record<string, RunEdge>,
  previous: Record<string, LayoutPosition> = {},
): Record<string, LayoutPosition> {
  const keys = Object.keys(nodes)
  const usableEdges = Object.values(edges).filter((edge) =>
    edge.status !== 'removed' && nodes[edge.source_node_key] && nodes[edge.target_node_key],
  )
  const incoming = new Map(keys.map((key) => [key, 0]))
  const outgoing = new Map(keys.map((key) => [key, [] as string[]]))
  for (const edge of usableEdges) {
    incoming.set(edge.target_node_key, (incoming.get(edge.target_node_key) ?? 0) + 1)
    outgoing.get(edge.source_node_key)?.push(edge.target_node_key)
  }

  const depths = new Map(keys.map((key) => [key, 0]))
  const queue = keys.filter((key) => incoming.get(key) === 0)
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]
    for (const target of outgoing.get(source) ?? []) {
      depths.set(target, Math.max(depths.get(target) ?? 0, (depths.get(source) ?? 0) + 1))
      incoming.set(target, (incoming.get(target) ?? 1) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }

  const byDepth = new Map<number, string[]>()
  for (const key of keys) {
    const depth = depths.get(key) ?? 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), key])
  }

  const result: Record<string, LayoutPosition> = {}
  for (const [depth, siblings] of byDepth) {
    siblings.sort((left, right) =>
      (nodes[left].plan_order ?? Number.MAX_SAFE_INTEGER) - (nodes[right].plan_order ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
    )
    const retained = siblings.filter((key) => previous[key]?.depth === depth)
    const occupied = new Set(retained.map((key) => previous[key].y))
    for (const key of retained) result[key] = previous[key]

    const fresh = siblings.filter((key) => !result[key])
    const centered = fresh.map((_, index) => ORIGIN_Y + (index - (fresh.length - 1) / 2) * ROW_GAP)
    for (const [index, key] of fresh.entries()) {
      let y = centered[index]
      let offset = 0
      while (occupied.has(y)) {
        offset += 1
        y = ORIGIN_Y + (offset % 2 === 0 ? -1 : 1) * Math.ceil(offset / 2) * ROW_GAP
      }
      occupied.add(y)
      result[key] = { x: ORIGIN_X + depth * COLUMN_GAP, y, depth }
    }
  }
  return result
}
