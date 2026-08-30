import type { RunEdge, RunNode } from './types'

export type LayoutPosition = { x: number; y: number; depth: number }
export type LayoutBounds = { x: number; y: number; width: number; height: number }
export type NodeSize = { width: number; height: number }
export type ViewportTransform = { x: number; y: number; zoom: number }
export type ViewportInsets = { top: number; right: number; bottom: number; left: number }

const COLUMN_GAP = 84
const ORIGIN_X = 48
const ORIGIN_Y = 280
export const NODE_WIDTH = 380
export const NODE_HEIGHT = 230
export const CARD_GAP = 60
export const FIT_PADDING = 0.08
export const MAX_FIT_ZOOM = 1.35
export const MIN_FIT_ZOOM = 0.18

function sizeFor(key: string, sizes: Record<string, NodeSize>): NodeSize {
  return sizes[key] ?? { width: NODE_WIDTH, height: NODE_HEIGHT }
}

export function getLayoutBounds(
  positions: Record<string, LayoutPosition>,
  sizes: Record<string, NodeSize> = {},
): LayoutBounds | null {
  const entries = Object.entries(positions)
  if (entries.length === 0) return null
  const left = Math.min(...entries.map(([, position]) => position.x))
  const top = Math.min(...entries.map(([, position]) => position.y))
  const right = Math.max(...entries.map(([key, position]) => position.x + sizeFor(key, sizes).width))
  const bottom = Math.max(...entries.map(([key, position]) => position.y + sizeFor(key, sizes).height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function getFitViewport(bounds: LayoutBounds, viewport: NodeSize) {
  const zoom = Math.min(
    Math.max(
      Math.min(
        (viewport.width * (1 - FIT_PADDING)) / Math.max(1, bounds.width),
        (viewport.height * (1 - FIT_PADDING)) / Math.max(1, bounds.height),
      ),
      MIN_FIT_ZOOM,
    ),
    MAX_FIT_ZOOM,
  )
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  }
}

export function getVisibleNodeViewport(
  position: Pick<LayoutPosition, 'x' | 'y'>,
  size: NodeSize,
  viewport: ViewportTransform,
  container: NodeSize,
  insets: ViewportInsets,
): ViewportTransform {
  const availableWidth = container.width - insets.left - insets.right
  const availableHeight = container.height - insets.top - insets.bottom
  if (availableWidth <= 0 || availableHeight <= 0) return viewport
  const zoom = Math.min(
    viewport.zoom,
    availableWidth / Math.max(1, size.width),
    availableHeight / Math.max(1, size.height),
  )
  const centerX = position.x + size.width / 2
  const centerY = position.y + size.height / 2
  let x = centerX * viewport.zoom + viewport.x - centerX * zoom
  let y = centerY * viewport.zoom + viewport.y - centerY * zoom
  let left = position.x * zoom + x
  let top = position.y * zoom + y
  const right = left + size.width * zoom
  const bottom = top + size.height * zoom

  if (right > container.width - insets.right) {
    const shift = right - (container.width - insets.right)
    x -= shift
    left -= shift
  }
  if (left < insets.left) x += insets.left - left
  if (bottom > container.height - insets.bottom) {
    const shift = bottom - (container.height - insets.bottom)
    y -= shift
    top -= shift
  }
  if (top < insets.top) y += insets.top - top

  return { x, y, zoom }
}

export function layoutGraph(
  nodes: Record<string, RunNode>,
  edges: Record<string, RunEdge>,
  previous: Record<string, LayoutPosition> = {},
  sizes: Record<string, NodeSize> = {},
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
    const depth = nodes[key].removed && previous[key]
      ? previous[key].depth
      : depths.get(key) ?? 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), key])
  }

  const columnX = new Map<number, number>()
  const maximumDepth = Math.max(0, ...byDepth.keys())
  let nextX = ORIGIN_X
  for (let depth = 0; depth <= maximumDepth; depth += 1) {
    columnX.set(depth, nextX)
    const siblings = byDepth.get(depth) ?? []
    const widest = Math.max(NODE_WIDTH, ...siblings.map((key) => sizeFor(key, sizes).width))
    nextX += widest + COLUMN_GAP
  }

  const result: Record<string, LayoutPosition> = {}
  for (const [depth, siblings] of byDepth) {
    siblings.sort((left, right) =>
      (nodes[left].plan_order ?? Number.MAX_SAFE_INTEGER) - (nodes[right].plan_order ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right),
    )
    const totalHeight = siblings.reduce((total, key) => total + sizeFor(key, sizes).height, 0) +
      Math.max(0, siblings.length - 1) * CARD_GAP
    let nextY = ORIGIN_Y + NODE_HEIGHT / 2 - totalHeight / 2
    for (const key of siblings) {
      result[key] = {
        x: columnX.get(depth) ?? ORIGIN_X,
        y: nextY,
        depth,
      }
      nextY += sizeFor(key, sizes).height + CARD_GAP
    }
  }
  return result
}
