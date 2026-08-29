'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Crosshair,
  FileCheck2,
  Pause,
  Play,
  RotateCcw,
  Scan,
  UserRound,
  X,
} from 'lucide-react'
import {
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import { RuntimeEdge, type RuntimeEdgeData, type RuntimeEdgeStatus } from '@/components/donald/runtime-edge'
import { getLayoutBounds, layoutGraph, NODE_HEIGHT, NODE_WIDTH, type LayoutPosition } from '@/lib/donald/layout'
import {
  getGraphPresentation,
  getLatestNodeStatus,
  getPlanRevealDurationMs,
  getVisiblyActiveNodeKey,
  keepStillRemovedKeys,
  type LiveNodeStatus,
  type NodePresentation,
} from '@/lib/donald/presentation'
import { applyEvent, createInitialRunState } from '@/lib/donald/reduce'
import { apiSource, recordedSource, type DonaldEventSource } from '@/lib/donald/source'
import type { DonaldEvent, NodeStatus, RunEdge, RunNode, RunState } from '@/lib/donald/types'
import '@xyflow/react/dist/style.css'

type DisplayStatus = 'WAITING' | 'RUNNING' | 'DONE' | 'NEEDS HUMAN' | 'BLOCKED' | 'FAILED' | 'SKIPPED'
type Capability =
  | 'INGEST'
  | 'IDENTIFY'
  | 'EXTRACT'
  | 'RECONCILE'
  | 'MONITOR'
  | 'PREDICT'
  | 'DETECT'
  | 'EXPLAIN'
  | 'IMPACT'
  | 'PLAN'
  | 'DECIDE'
  | 'ACT'

type FlowNodeData = {
  runtimeNode: RunNode
  displayStatus: DisplayStatus
  capability: Capability
  nextTask: string
  selected: boolean
  visiblyActive: boolean
  appearance: NodePresentation
  liveStatus: LiveNodeStatus | null
  onSelect: () => void
}

const RUN_KEY = '3482'
const API_BASE_URL = process.env.NEXT_PUBLIC_DONALD_API
const edgeTypes = { signal: RuntimeEdge }
const nodeTypes = { flow: FlowNodeRenderer }

function createSource(): DonaldEventSource {
  return API_BASE_URL ? apiSource(API_BASE_URL, RUN_KEY) : recordedSource()
}

function displayStatus(status: NodeStatus): DisplayStatus {
  switch (status) {
    case 'in_progress': return 'RUNNING'
    case 'succeeded': return 'DONE'
    case 'blocked_on_user_decision': return 'NEEDS HUMAN'
    case 'blocked_on_missing_data':
    case 'blocked_on_provider_outage': return 'BLOCKED'
    case 'failed': return 'FAILED'
    case 'cancelled':
    case 'skipped': return 'SKIPPED'
    case 'not_started': return 'WAITING'
  }
}

function runStatusLabel(state: RunState): string {
  switch (state.run.status) {
    case 'running': return state.open_intervention ? 'NEEDS HUMAN' : 'RUNNING'
    case 'finished': return 'DONE'
    case 'failed': return 'FAILED'
    case 'cancelled': return 'SKIPPED'
    case 'not_started': return 'WAITING'
  }
}

function statusClass(status: DisplayStatus): string {
  return status.toLowerCase().replace(' ', '-')
}

function capabilityFor(node: RunNode): Capability {
  const text = `${node.node_key} ${node.label}`.toLowerCase()
  if (node.status === 'blocked_on_user_decision' || text.includes('decid') || text.includes('elegir')) return 'DECIDE'
  if (text.includes('receive') || text.includes('leer') || text.includes('actualización')) return 'INGEST'
  if (text.includes('reconcile') || text.includes('comparar') || text.includes('bill of lading')) return 'RECONCILE'
  if (text.includes('impact')) return 'IMPACT'
  if (text.includes('monitor')) return 'MONITOR'
  if (text.includes('quote') || text.includes('cotizar')) return 'PLAN'
  return 'ACT'
}

function capabilitiesFor(node: RunNode): Capability[] {
  const primary = capabilityFor(node)
  if (primary === 'INGEST') return ['INGEST', 'IDENTIFY', 'EXTRACT']
  if (primary === 'IMPACT') return ['EXPLAIN', 'IMPACT']
  if (primary === 'MONITOR') return ['MONITOR', 'PREDICT', 'DETECT']
  if (primary === 'PLAN') return ['PLAN', 'ACT']
  if (primary === 'RECONCILE') return ['RECONCILE', 'ACT']
  return [primary]
}

function ArcBeacon() {
  return <span className="arc-beacon" aria-hidden="true"><i /></span>
}

function StatusMark({ status }: { status: DisplayStatus }) {
  if (status === 'RUNNING') return <ArcBeacon />
  if (status === 'DONE') return <Check size={11} />
  if (status === 'NEEDS HUMAN' || status === 'BLOCKED' || status === 'FAILED') return <AlertTriangle size={11} />
  return <CircleDot size={9} />
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`status status-${statusClass(status)}`}><StatusMark status={status} />{status}</span>
}

function FlowCard({ data }: { data: FlowNodeData }) {
  const { runtimeNode: node } = data
  const proposed = node.planned && data.displayStatus === 'WAITING'
  const classes = [
    'flow-card',
    statusClass(data.displayStatus),
    proposed ? 'proposed' : '',
    node.removed ? 'removed' : '',
    data.selected ? 'selected' : '',
    data.visiblyActive ? 'visibly-active' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} onClick={data.onSelect} role="button" tabIndex={0}>
      <div className="flow-card-content">
        <Handle type="target" position={Position.Left} />
        <div className="card-top"><span className="capability">{data.capability}</span></div>
        <div className="task-meta">
          <span>TASK</span>
          {data.visiblyActive && <ArcBeacon />}
          <b className="task-state">{data.displayStatus}</b>
        </div>
        <div className="task-title">{node.label}</div>
        <div className="next-task">
          {data.nextTask === 'COMPLETE' ? <b>COMPLETE</b> : <><span>NEXT TASK</span><b>{data.nextTask}</b></>}
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    </div>
  )
}

type StatusTransitionItem = LiveNodeStatus & { leaving: boolean }

function LiveStatusLabel({ status }: { status: LiveNodeStatus | null }) {
  const [items, setItems] = useState<StatusTransitionItem[]>(() => status ? [{ ...status, leaving: false }] : [])
  const latestKey = useRef(status?.key ?? null)

  useEffect(() => {
    const nextKey = status?.key ?? null
    if (nextKey === latestKey.current) return
    latestKey.current = nextKey
    setItems((current) => [
      ...current.filter((item) => !item.leaving).map((item) => ({ ...item, leaving: true })),
      ...(status ? [{ ...status, leaving: false }] : []),
    ])
    const timer = window.setTimeout(() => {
      setItems(status ? [{ ...status, leaving: false }] : [])
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180)
    return () => window.clearTimeout(timer)
  }, [status])

  if (items.length === 0) return null
  return (
    <div className="live-status-anchor" aria-live="polite">
      {items.map((item) => (
        <div className={`live-status-label ${item.leaving ? 'leaving' : 'entering'}`} key={item.key}>
          <span className="live-status-dot" aria-hidden="true" />
          {item.text}
        </div>
      ))}
    </div>
  )
}

function FlowNodeRenderer(props: NodeProps) {
  const data = props.data as unknown as FlowNodeData
  const style = { '--node-enter-delay': `${data.appearance.delayMs}ms` } as CSSProperties
  const classes = [
    'flow-node-shell',
    'born',
    data.appearance.discovered ? 'discovered' : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={classes} style={style}>
      <FlowCard data={data} />
      <LiveStatusLabel status={data.liveStatus} />
    </div>
  )
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString().slice(11, 19)
}

function formatDuration(node: RunNode): string {
  if (typeof node.actual_seconds === 'number') return `${node.actual_seconds.toFixed(1)}s`
  if (typeof node.elapsed_seconds === 'number') return `${node.elapsed_seconds.toFixed(1)}s`
  if (node.started_at && node.finished_at) {
    return `${Math.max(0, (Date.parse(node.finished_at) - Date.parse(node.started_at)) / 1_000).toFixed(1)}s`
  }
  return '-'
}

function eventDescription(event: DonaldEvent): string {
  const label = typeof event.payload.label === 'string' ? event.payload.label : event.node_key
  const actor = event.agent_label ?? 'Donald'
  switch (event.event_type) {
    case 'run_started': return 'Run started'
    case 'plan_declared': return 'Execution plan declared'
    case 'node_added': return `${actor} added ${label ?? 'a runtime node'}`
    case 'node_removed': return `${actor} removed ${label ?? event.node_key ?? 'a runtime node'}`
    case 'edge_added': return 'Flow connection added'
    case 'edge_removed': return 'Flow connection removed'
    case 'node_status_changed': return `${actor} changed ${event.node_key ?? 'node'} status`
    case 'node_updated': {
      const headline = typeof event.payload.headline === 'string' ? ` · ${event.payload.headline}` : ''
      return `${actor} updated ${event.node_key ?? 'node'}${headline}`
    }
    case 'artifact_added': return `${actor} added evidence`
    case 'agent_message': return typeof event.payload.message === 'string' ? event.payload.message : `${actor} sent a message`
    case 'run_updated': return 'Execution graph replanned'
    case 'intervention_requested': return 'Human decision requested'
    case 'intervention_resolved': return 'Human decision resolved'
    case 'run_finished': return 'Run finished'
    default: return 'Runtime event received'
  }
}

function nextTaskFor(nodeKey: string, nodes: Record<string, RunNode>, edges: Record<string, RunEdge>): string {
  const targets = Object.values(edges)
    .filter((edge) => edge.source_node_key === nodeKey && edge.status !== 'removed')
    .map((edge) => nodes[edge.target_node_key])
    .filter((node): node is RunNode => Boolean(node && !node.removed))
    .sort((left, right) => (left.plan_order ?? 0) - (right.plan_order ?? 0))
  return targets[0]?.label ?? 'COMPLETE'
}

function predecessorSummary(nodeKey: string, state: RunState): string {
  const edge = Object.values(state.edges).find((item) => item.target_node_key === nodeKey && item.status !== 'removed')
  const predecessor = edge ? state.nodes[edge.source_node_key] : null
  return predecessor?.output_summary?.headline ?? 'Operational context from previous step'
}

function evidenceRows(node: RunNode): Array<[string, string]> {
  const rows: Array<[string, string]> = []
  for (const [key, value] of Object.entries(node.output_summary?.metrics ?? {})) rows.push([key, String(value)])
  for (const artifact of node.artifacts) rows.push([artifact.artifact_type.toUpperCase(), artifact.name])
  for (const evidenceId of node.output_summary?.evidence_ids ?? []) rows.push(['EVIDENCE ID', evidenceId])
  if (node.removal_reason) rows.push(['REASON', node.removal_reason])
  return rows
}

export default function Page() {
  const [state, setState] = useState(() => createInitialRunState(RUN_KEY))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedCapability, setSelectedCapability] = useState<Capability | null>(null)
  const [running, setRunning] = useState(true)
  const [streamOpen, setStreamOpen] = useState(true)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [planRevealing, setPlanRevealing] = useState(false)
  const [hiddenRemoved, setHiddenRemoved] = useState<Set<string>>(() => new Set())
  const [hiddenRemovedEdges, setHiddenRemovedEdges] = useState<Set<string>>(() => new Set())
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const sourceRef = useRef<DonaldEventSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const planRevealTimerRef = useRef<number | null>(null)
  const readPromiseRef = useRef<Promise<DonaldEvent | null> | null>(null)
  const layoutRef = useRef<Record<string, LayoutPosition>>({})
  if (!sourceRef.current) sourceRef.current = createSource()

  const readNext = useCallback((immediate = false): Promise<DonaldEvent | null> => {
    if (readPromiseRef.current) return readPromiseRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const source = sourceRef.current
    if (!source) return Promise.resolve(null)

    const promise = (async () => {
      try {
        const result = await source.next({ immediate, signal: controller.signal })
        if (result.done) {
          setRunning(false)
          return null
        }
        const event = result.value
        setState((current) => applyEvent(current, event))
        if (event.event_type === 'plan_declared') {
          if (planRevealTimerRef.current !== null) window.clearTimeout(planRevealTimerRef.current)
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          const duration = reduceMotion ? 0 : getPlanRevealDurationMs(event)
          setPlanRevealing(duration > 0)
          planRevealTimerRef.current = window.setTimeout(() => {
            setPlanRevealing(false)
            planRevealTimerRef.current = null
          }, duration)
        }
        if (event.node_key) {
          setSelectedKey((current) => current ?? event.node_key)
          if (event.event_type === 'node_status_changed' || event.event_type === 'intervention_requested') {
            setSelectedKey(event.node_key)
          }
        }
        if (event.event_type === 'intervention_requested') setRunning(false)
        setSourceError(null)
        return event
      } catch (error: unknown) {
        if (controller.signal.aborted) return null
        setSourceError(error instanceof Error ? error.message : 'Runtime source failed')
        setRunning(false)
        return null
      } finally {
        readPromiseRef.current = null
        if (abortRef.current === controller) abortRef.current = null
      }
    })()
    readPromiseRef.current = promise
    return promise
  }, [])

  useEffect(() => {
    if (!running || state.open_intervention) return
    let cancelled = false
    void (async () => {
      while (!cancelled) {
        const event = await readNext(false)
        if (!event || event.event_type === 'intervention_requested') break
      }
    })()
    return () => { cancelled = true }
  }, [readNext, running, state.open_intervention])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (planRevealTimerRef.current !== null) window.clearTimeout(planRevealTimerRef.current)
  }, [])

  useEffect(() => {
    const removedKeys = Object.values(state.nodes)
      .filter((node) => node.removed)
      .map((node) => node.node_key)
    setHiddenRemoved((current) => keepStillRemovedKeys(current, removedKeys))
  }, [state.nodes])

  useEffect(() => {
    const timers = Object.values(state.nodes)
      .filter((node) => node.removed && !hiddenRemoved.has(node.node_key))
      .map((node) => window.setTimeout(() => {
        setHiddenRemoved((current) => new Set(current).add(node.node_key))
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520))
    return () => timers.forEach(window.clearTimeout)
  }, [hiddenRemoved, state.nodes])

  useEffect(() => {
    const removedKeys = Object.values(state.edges)
      .filter((edge) => edge.status === 'removed' ||
        state.nodes[edge.source_node_key]?.removed ||
        state.nodes[edge.target_node_key]?.removed)
      .map((edge) => edge.edge_key)
    setHiddenRemovedEdges((current) => keepStillRemovedKeys(current, removedKeys))
  }, [state.edges, state.nodes])

  useEffect(() => {
    const timers = Object.values(state.edges)
      .filter((edge) => {
        const exiting = edge.status === 'removed' ||
          state.nodes[edge.source_node_key]?.removed ||
          state.nodes[edge.target_node_key]?.removed
        return exiting && !hiddenRemovedEdges.has(edge.edge_key)
      })
      .map((edge) => window.setTimeout(() => {
        setHiddenRemovedEdges((current) => new Set(current).add(edge.edge_key))
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420))
    return () => timers.forEach(window.clearTimeout)
  }, [hiddenRemovedEdges, state.edges, state.nodes])

  const visibleNodes = useMemo(() => Object.fromEntries(
    Object.entries(state.nodes).filter(([key]) => !hiddenRemoved.has(key)),
  ), [hiddenRemoved, state.nodes])

  const structuralSignature = useMemo(() => [
    ...Object.values(visibleNodes).map((node) => `${node.node_key}:${node.removed}`).sort(),
    ...Object.values(state.edges).map((edge) => `${edge.edge_key}:${edge.status}`).sort(),
  ].join('|'), [state.edges, visibleNodes])

  const layout = useMemo(() => {
    const retainedNodes = Object.fromEntries(Object.entries(visibleNodes).filter(([, node]) => !node.removed))
    const next = layoutGraph(retainedNodes, state.edges, layoutRef.current)
    const exiting = Object.fromEntries(Object.values(visibleNodes)
      .filter((node) => node.removed && layoutRef.current[node.node_key])
      .map((node) => [node.node_key, layoutRef.current[node.node_key]]))
    const withExiting = { ...next, ...exiting }
    layoutRef.current = { ...layoutRef.current, ...withExiting }
    return withExiting
  }, [structuralSignature])

  const graphPresentation = useMemo(() => getGraphPresentation(state.event_log), [state.event_log])
  const visiblyActiveKey = useMemo(
    () => planRevealing ? null : getVisiblyActiveNodeKey(visibleNodes, state.event_log),
    [planRevealing, state.event_log, visibleNodes],
  )

  const selectNode = useCallback((node: RunNode) => {
    setSelectedKey(node.node_key)
    setSelectedCapability(capabilityFor(node))
    const position = layoutRef.current[node.node_key]
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520
    if (position) flowInstance?.setCenter(position.x + 136, position.y + 90, { zoom: 1.28, duration })
  }, [flowInstance])

  const visualNodes: Node[] = useMemo(() => Object.values(visibleNodes).map((node) => ({
    id: node.node_key,
    type: 'flow',
    position: { x: layout[node.node_key].x, y: layout[node.node_key].y },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: {
      runtimeNode: node,
      displayStatus: displayStatus(planRevealing && node.status === 'in_progress' ? 'not_started' : node.status),
      capability: capabilityFor(node),
      nextTask: nextTaskFor(node.node_key, state.nodes, state.edges),
      selected: selectedKey === node.node_key,
      visiblyActive: visiblyActiveKey === node.node_key,
      appearance: graphPresentation.nodes[node.node_key] ?? { delayMs: 0, discovered: false, batch: 0 },
      liveStatus: visiblyActiveKey === node.node_key ? getLatestNodeStatus(node, state.event_log) : null,
      onSelect: () => selectNode(node),
    } satisfies FlowNodeData,
  })), [graphPresentation.nodes, layout, planRevealing, selectNode, selectedKey, state.edges, state.event_log, state.nodes, visibleNodes, visiblyActiveKey])

  const visualEdges: Edge[] = useMemo(() => Object.values(state.edges)
    .filter((edge) => !hiddenRemovedEdges.has(edge.edge_key) && visibleNodes[edge.source_node_key] && visibleNodes[edge.target_node_key])
    .map((edge) => {
      const source = state.nodes[edge.source_node_key]
      const target = state.nodes[edge.target_node_key]
      const exiting = edge.status === 'removed' || source.removed || target.removed
      const status: RuntimeEdgeStatus =
        target.node_key === visiblyActiveKey ? 'ACTIVE' :
        source.status === 'failed' || target.status === 'failed' ? 'FAILED' :
        target.status.startsWith('blocked_on_') ? 'BLOCKED' :
        edge.status === 'traversed' ? 'DONE' :
        edge.status === 'skipped' ? 'SKIPPED' :
        'WAITING'
      const data: RuntimeEdgeData = {
        status,
        signalKey: state.last_sequence,
        selected: selectedKey === edge.source_node_key || selectedKey === edge.target_node_key,
        enterDelayMs: graphPresentation.edges[edge.edge_key]?.delayMs ?? 0,
        exiting,
      }
      return {
        id: edge.edge_key,
        source: edge.source_node_key,
        target: edge.target_node_key,
        type: 'signal',
        data,
      }
    }), [graphPresentation.edges, hiddenRemovedEdges, selectedKey, state.edges, state.last_sequence, state.nodes, visibleNodes, visiblyActiveKey])

  const layoutSignature = useMemo(() => [
    ...visualNodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).sort(),
    ...visualEdges.map((edge) => edge.id).sort(),
  ].join('|'), [visualEdges, visualNodes])

  const zoomToFit = useCallback(() => {
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520
    const bounds = getLayoutBounds(layout)
    if (bounds) void flowInstance?.fitBounds(bounds, { padding: .18, duration })
  }, [flowInstance, layout])

  useEffect(() => {
    if (!flowInstance || visualNodes.length === 0) return
    const settledFit = window.setTimeout(zoomToFit, 180)
    return () => window.clearTimeout(settledFit)
  }, [flowInstance, layoutSignature, visualNodes.length, zoomToFit])

  const pause = useCallback(() => {
    setRunning(false)
    abortRef.current?.abort()
  }, [])

  const nextStep = useCallback(async () => {
    setRunning(false)
    abortRef.current?.abort()
    await readPromiseRef.current
    await readNext(true)
  }, [readNext])

  const reset = useCallback(async () => {
    setRunning(false)
    abortRef.current?.abort()
    await readPromiseRef.current
    sourceRef.current = createSource()
    layoutRef.current = {}
    if (planRevealTimerRef.current !== null) window.clearTimeout(planRevealTimerRef.current)
    planRevealTimerRef.current = null
    setState(createInitialRunState(RUN_KEY))
    setSelectedKey(null)
    setSelectedCapability(null)
    setHiddenRemoved(new Set())
    setHiddenRemovedEdges(new Set())
    setPlanRevealing(false)
    setSourceError(null)
    setRunning(true)
  }, [])

  const addBL = useCallback(async () => {
    if (state.nodes['secure-new-bl']) return
    setRunning(false)
    abortRef.current?.abort()
    await readPromiseRef.current
    for (let count = 0; count < 80; count += 1) {
      const event = await readNext(true)
      if (!event || (event.event_type === 'node_added' && event.node_key === 'secure-new-bl')) break
    }
  }, [readNext, state.nodes])

  const selectedNode = selectedKey ? state.nodes[selectedKey] : null
  const active = selectedNode && !hiddenRemoved.has(selectedNode.node_key)
    ? selectedNode
    : visiblyActiveKey ? state.nodes[visiblyActiveKey] : Object.values(visibleNodes)[0] ?? null
  const activeCapabilities = active ? capabilitiesFor(active) : []
  const inspectorCapability = selectedCapability && activeCapabilities.includes(selectedCapability)
    ? selectedCapability
    : activeCapabilities[0] ?? null
  const activeDisplayStatus = active
    ? displayStatus(planRevealing && active.status === 'in_progress' ? 'not_started' : active.status)
    : 'WAITING'
  const rows = active ? evidenceRows(active) : []
  const output = active?.output_summary?.headline ?? active?.output_summary?.detail ??
    (active?.status === 'in_progress' ? 'Work in progress' : 'Waiting for runtime output')
  const activeLiveStatus = active ? getLatestNodeStatus(active, state.event_log) : null
  const showHumanDecision = Boolean(state.open_intervention && active?.node_key === state.open_intervention.node_key)
  const latestEvents = [...state.event_log].reverse().slice(0, 8)

  return (
    <main className="donald">
      <header className="header">
        <div className="brand"><img className="brand-logo" src="/donald-logo-official.png" alt="Donald" /></div>
        <div className="run-meta">
          <div><span className="meta-label">ORGANIZATION</span>Muebles del Sur</div>
          <div><span className="meta-label">FLOW</span>Booking Monitoring</div>
          <div><span className="meta-label">OPERATION</span><code>OP-2048</code></div>
          <div><span className="meta-label">RUN</span><code>#{state.run.key}</code></div>
          <div className="run-state"><span className="live-dot" />{runStatusLabel(state)}</div>
        </div>
      </header>

      <section className="toolbar">
        <div className="crumb"><Crosshair size={15} /> LIVE RUN VIEWER <span>/</span> <b>Booking Monitoring</b></div>
        <div className="controls">
          <button className="text-btn"><span className="live-dot" /> FOLLOW LIVE</button>
          <button onClick={() => setRunning(true)} disabled={running} className="dark-btn"><Play size={14} /> PLAY</button>
          <button onClick={pause} disabled={!running} className="dark-btn"><Pause size={14} /> PAUSE</button>
          <button onClick={() => void nextStep()} className="dark-btn"><ArrowRight size={14} /> NEXT STEP</button>
          <button onClick={() => void reset()} className="icon-btn" aria-label="Reset"><RotateCcw size={15} /></button>
        </div>
      </section>

      <div className="workspace">
        <section className="canvas-panel">
          <div className="canvas-label">
            <div className="canvas-title"><button className="fit-view-btn" onClick={zoomToFit} aria-label="Zoom out to full workflow"><Scan size={14} /></button><span>EXECUTION GRAPH</span></div>
            <span className="mono">LIVE · {state.event_log.length} EVENTS · {Object.keys(visibleNodes).length} NODES · REV {state.run.graph_revision}</span>
          </div>
          <div className="flow-wrap">
            <ReactFlow
              nodes={visualNodes}
              edges={visualEdges}
              edgeTypes={edgeTypes}
              nodeTypes={nodeTypes}
              onInit={setFlowInstance}
              fitView
              fitViewOptions={{ padding: .24, maxZoom: 1.18 }}
              nodesDraggable={false}
              nodesConnectable={false}
              onlyRenderVisibleElements={false}
              minZoom={.28}
            />
            <div className="network-points" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
            <div className="phase-key">{['UNDERSTAND', 'ESTABLISH TRUTH', 'WATCH & DETECT', 'UNDERSTAND THE PROBLEM', 'RESOLVE'].map((phase) => <span key={phase}><i /> {phase}</span>)}</div>
            {sourceError && <div className="source-error"><AlertTriangle size={14} /> {sourceError}</div>}
          </div>
        </section>

        <aside className={`inspector ${showHumanDecision ? 'human' : ''}`}>
          <div className="inspector-head">
            <div><div className="eyebrow">NODE INSPECTOR</div><h2>{active?.label ?? 'Waiting for runtime'}</h2></div>
            <button className="close-btn" onClick={() => setSelectedKey(null)} aria-label="Close inspector selection"><X size={15} /></button>
          </div>

          {showHumanDecision && state.open_intervention ? (
            <div className="decision">
              <div className="needs"><AlertTriangle size={18} /> DECISION REQUIRED</div>
              <h1>Decision required</h1>
              <p>{state.open_intervention.prompt}</p>
              <div className="options">
                {state.open_intervention.options.map((option, index) => (
                  <div className={index === 0 ? 'recommended' : ''} key={option.id}>
                    <b>{option.label.toUpperCase()}</b><span>{option.rationale}</span>
                  </div>
                ))}
              </div>
              <button className="approve" onClick={() => void nextStep()}><Check size={16} /> APPROVE ALTERNATIVE</button>
              <div className="secondary-actions"><button onClick={() => void nextStep()}>KEEP CURRENT</button><button onClick={() => void nextStep()}>NOTIFY CLIENT</button></div>
            </div>
          ) : active ? (
            <div className="detail">
              <div className="detail-status"><StatusBadge status={activeDisplayStatus} /><span><UserRound size={13} /> {active.agent_label ?? 'Donald'}</span></div>
              <section>
                <label>CAPABILITIES</label>
                <div className="inspector-capabilities">
                  {activeCapabilities.map((capability) => (
                    <button className={inspectorCapability === capability ? 'selected' : ''} key={capability} onClick={() => setSelectedCapability(capability)}>
                      <span>{capability}</span><b><StatusMark status={activeDisplayStatus} /> {activeDisplayStatus}</b>
                      {active.status === 'succeeded' && <small>Output: {output}</small>}
                      {active.status === 'in_progress' && !planRevealing && <small>Current: {activeLiveStatus?.text ?? 'Work in progress'}</small>}
                    </button>
                  ))}
                </div>
              </section>
              <div className="timing"><div><span>STARTED</span><code>{formatTime(active.started_at)}</code></div><div><span>DURATION</span><code>{formatDuration(active)}</code></div></div>
              <section><label>INPUT</label><p>{active.input_summary ?? predecessorSummary(active.node_key, state)}</p></section>
              <section><label>OUTPUT</label><p className="output-large">{output}</p>{active.output_summary?.detail && active.output_summary.detail !== output && <p>{active.output_summary.detail}</p>}</section>
              <section><label>EVIDENCE</label>{rows.length ? rows.map(([key, value], index) => <div className="kv" key={`${key}-${index}`}><span>{key}</span><b>{value}</b></div>) : <p>Waiting for evidence</p>}</section>
              {(active.status === 'failed' || active.status.startsWith('blocked_on_')) && <div className="warning"><AlertTriangle size={15} /> High severity exception</div>}
            </div>
          ) : <div className="detail"><p>Waiting for runtime events</p></div>}
        </aside>
      </div>

      <footer className={`event-stream ${streamOpen ? 'open' : ''}`}>
        <button className="stream-toggle" onClick={() => setStreamOpen(!streamOpen)}>
          <div><span className="live-dot" /> LIVE EVENT STREAM <span className="event-count">{state.event_log.length} EVENTS</span></div>
          {streamOpen ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        {streamOpen && <div className="events">{latestEvents.map((event) => <div className="event" key={event.idempotency_key}><code>{formatTime(event.occurred_at)}</code><span>{eventDescription(event)}</span></div>)}</div>}
      </footer>

      <div className="demo-menu"><button onClick={() => void addBL()}><FileCheck2 size={15} /> {state.nodes['secure-new-bl'] ? 'BL VALIDATION ADDED' : 'ADD BL VALIDATION STEP'}</button></div>
    </main>
  )
}
