'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock3,
  FileText,
  RotateCcw,
  Send,
  UserRound,
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
import {
  getLayoutBounds,
  layoutGraph,
  type LayoutPosition,
  type NodeSize,
} from '@/lib/donald/layout'
import {
  getGraphPresentation,
  getInstructionLifecycle,
  getLatestNodeStatus,
  getLatestRecalculation,
  getLatestReplan,
  getPrimaryMetric,
  getRunRequest,
  getVisiblyActiveNodeKey,
  metricRows,
  type InstructionLifecycle,
  type LiveNodeStatus,
  type NodePresentation,
} from '@/lib/donald/presentation'
import { applyEvent, createInitialRunState } from '@/lib/donald/reduce'
import {
  apiSource,
  postOperatorInstruction,
  recordedSource,
  type DonaldEventSource,
} from '@/lib/donald/source'
import type {
  DonaldEvent,
  InterventionOption,
  NodeStatus,
  OpenIntervention,
  RunArtifact,
  RunEdge,
  RunNode,
  RunState,
} from '@/lib/donald/types'
import '@xyflow/react/dist/style.css'

type DisplayStatus = 'PROPOSED' | 'WAITING' | 'RUNNING' | 'DONE' | 'NEEDS HUMAN' | 'BLOCKED' | 'FAILED' | 'SKIPPED' | 'REMOVED'

type MeasuredNodeSize = NodeSize & { expanded: boolean }

type FlowNodeData = {
  runtimeNode: RunNode
  displayStatus: DisplayStatus
  expanded: boolean
  visiblyActive: boolean
  appearance: NodePresentation
  liveStatus: LiveNodeStatus | null
  intervention: OpenIntervention | null
  instructionLifecycle: InstructionLifecycle | null
  instructionError: string | null
  submitting: boolean
  onToggle: () => void
  onResize: (size: NodeSize) => void
  onInstruction: (instruction: string, optionId?: string | null) => Promise<void>
}

const API_BASE_URL = process.env.NEXT_PUBLIC_DONALD_API ?? null
const COLLAPSED_SIZE: NodeSize = { width: 300, height: 190 }
const EXPANDED_SIZE: NodeSize = { width: 430, height: 650 }
const edgeTypes = { signal: RuntimeEdge }
const nodeTypes = { flow: FlowNodeRenderer }

function createSource(runKey: string | null): DonaldEventSource {
  return API_BASE_URL ? apiSource(API_BASE_URL, runKey) : recordedSource()
}

function displayStatus(node: RunNode): DisplayStatus {
  if (node.removed) return 'REMOVED'
  if (node.planned && node.status === 'not_started') return 'PROPOSED'
  switch (node.status) {
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
  if (state.open_intervention) return 'NEEDS HUMAN'
  switch (state.run.status) {
    case 'running': return 'RUNNING'
    case 'finished': return 'DONE'
    case 'failed': return 'FAILED'
    case 'cancelled': return 'CANCELLED'
    case 'not_started': return 'CONNECTING'
  }
}

function statusClass(status: DisplayStatus): string {
  return status.toLowerCase().replace(' ', '-')
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDuration(node: RunNode): string {
  const seconds = node.actual_seconds ?? node.elapsed_seconds ??
    (node.started_at && node.finished_at
      ? Math.max(0, (Date.parse(node.finished_at) - Date.parse(node.started_at)) / 1_000)
      : null)
  return typeof seconds === 'number' ? `${seconds.toFixed(1)}s` : '—'
}

function eventDescription(event: DonaldEvent): string {
  const label = typeof event.payload.label === 'string' ? event.payload.label : event.node_key
  const actor = event.agent_label ?? 'Donald'
  switch (event.event_type) {
    case 'run_started': return 'Run started'
    case 'plan_declared': return 'Execution plan declared'
    case 'node_added': return `${actor} added ${label ?? 'a step'}`
    case 'node_removed': return `${actor} removed ${label ?? 'a step'}`
    case 'edge_added': return 'Flow connection added'
    case 'edge_removed': return 'Flow connection removed'
    case 'node_status_changed': return `${actor} changed ${event.node_key ?? 'step'} status`
    case 'node_updated': return typeof event.payload.headline === 'string'
      ? `${actor}: ${event.payload.headline}`
      : `${actor} updated ${event.node_key ?? 'a step'}`
    case 'artifact_added': return `${actor} added evidence`
    case 'agent_message': return typeof event.payload.message === 'string' ? event.payload.message : `${actor} sent a message`
    case 'run_updated': return 'Execution graph replanned'
    case 'intervention_requested': return 'Human decision requested'
    case 'intervention_resolved': return 'Human decision resolved'
    case 'operator_instruction_queued': return 'Operator instruction queued'
    case 'operator_instruction_delivered': return 'Operator instruction delivered'
    case 'operator_instruction_resolved': return 'Operator instruction resolved'
    case 'run_finished': return 'Run finished'
    default: return 'Runtime event received'
  }
}

function parseMessageMeta(artifact: RunArtifact): { sender: string | null; date: string | null } {
  const text = artifact.text_content ?? ''
  return {
    sender: text.match(/^From:\s*(.+)$/mi)?.[1]?.trim() ?? null,
    date: text.match(/^Date:\s*(.+)$/mi)?.[1]?.trim() ?? null,
  }
}

function StatusMark({ status }: { status: DisplayStatus }) {
  if (status === 'RUNNING') return <span className="spinner" aria-label="Running" />
  if (status === 'DONE') return <Check size={12} aria-hidden="true" />
  if (status === 'NEEDS HUMAN' || status === 'BLOCKED' || status === 'FAILED') {
    return <AlertTriangle size={12} aria-hidden="true" />
  }
  return <CircleDot size={10} aria-hidden="true" />
}

function ArtifactBlock({ artifact }: { artifact: RunArtifact }) {
  const meta = parseMessageMeta(artifact)
  return (
    <article className="artifact-block">
      <div className="artifact-heading">
        <FileText size={14} aria-hidden="true" />
        <div>
          <strong>{artifact.name}</strong>
          <span>{[artifact.message_id, meta.sender, meta.date].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {artifact.text_content && <blockquote><pre>{artifact.text_content}</pre></blockquote>}
    </article>
  )
}

function InstructionTrail({ lifecycle }: { lifecycle: InstructionLifecycle }) {
  const milestones = [
    { status: 'queued', label: 'Queued', time: lifecycle.queuedAt, reached: true },
    { status: 'delivered', label: 'Delivered', time: lifecycle.deliveredAt, reached: Boolean(lifecycle.deliveredAt) },
    { status: 'resolved', label: 'Resolved', time: lifecycle.resolvedAt, reached: Boolean(lifecycle.resolvedAt) },
  ]
  return (
    <div className="instruction-state" aria-live="polite">
      <strong>{lifecycle.status === 'queued' ? 'Queued — not yet picked up' : `Instruction ${lifecycle.status}`}</strong>
      <div className="instruction-milestones">
        {milestones.map((milestone) => (
          <div className={milestone.reached ? 'reached' : ''} key={milestone.status}>
            <i aria-hidden="true" />
            <span>{milestone.label}</span>
            <time>{milestone.time ? formatTime(milestone.time) : 'Pending'}</time>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionButton({
  option,
  disabled,
  onChoose,
}: {
  option: InterventionOption
  disabled: boolean
  onChoose: (option: InterventionOption) => void
}) {
  const cost = option.maximum_cost_usd === null
    ? null
    : `$${new Intl.NumberFormat('en-US').format(option.maximum_cost_usd)} USD`
  return (
    <button
      className={`decision-option ${option.rank === 1 ? 'recommended' : ''}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChoose(option)
      }}
      type="button"
    >
      <span className="option-title">
        <b>{option.label}</b>
        {option.rank === 1 && <em>Recommended</em>}
        {cost && <strong>{cost}</strong>}
      </span>
      {option.rationale && <small>{option.rationale}</small>}
      {(option.document || option.client_commitment) && (
        <span className="option-meta">
          {option.document && `Document · ${option.document}`}
          {option.document && option.client_commitment && ' · '}
          {option.client_commitment && `Commitment · ${option.client_commitment}`}
        </span>
      )}
    </button>
  )
}

function InstructionBox({ data }: { data: FlowNodeData }) {
  const [instruction, setInstruction] = useState('')
  const options = [...(data.intervention?.options ?? [])].sort((left, right) =>
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER),
  )
  const sent = Boolean(data.instructionLifecycle)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const value = instruction.trim()
    if (value) void data.onInstruction(value)
  }

  return (
    <section
      className="intervention"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {data.intervention && (
        <>
          <div className="section-label"><AlertTriangle size={13} /> Human input required</div>
          <p className="intervention-prompt">{data.intervention.prompt}</p>
          <div className="decision-options">
            {options.map((option) => (
              <OptionButton
                disabled={data.submitting || sent}
                key={option.id}
                onChoose={(selected) => void data.onInstruction(selected.label, selected.id)}
                option={option}
              />
            ))}
            {options.length === 0 && (
              <button
                className="acknowledge"
                disabled={data.submitting || sent}
                onClick={() => void data.onInstruction('Acknowledged')}
                type="button"
              >
                Acknowledge
              </button>
            )}
          </div>
        </>
      )}
      <form className="instruction-form" onSubmit={submit}>
        <label htmlFor={`instruction-${data.runtimeNode.node_key}`}>Give the agent an instruction</label>
        <div>
          <textarea
            disabled={data.submitting || sent}
            id={`instruction-${data.runtimeNode.node_key}`}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Type a concrete instruction for this step…"
            rows={3}
            value={instruction}
          />
          <button disabled={!instruction.trim() || data.submitting || sent} type="submit">
            <Send size={14} /> Send
          </button>
        </div>
      </form>
      {data.instructionLifecycle && <InstructionTrail lifecycle={data.instructionLifecycle} />}
      {data.instructionError && <p className="instruction-error">{data.instructionError}</p>}
    </section>
  )
}

function ExpandedDetails({ data }: { data: FlowNodeData }) {
  const node = data.runtimeNode
  const metrics = metricRows(node.output_summary?.metrics ?? {})
  const blocked = node.status.startsWith('blocked_on_')
  return (
    <div className="card-details" onClick={(event) => event.stopPropagation()}>
      {(node.output_summary?.detail || node.input_summary) && (
        <section>
          {node.output_summary?.detail && <><div className="section-label">Finding</div><p>{node.output_summary.detail}</p></>}
          {node.input_summary && <><div className="section-label secondary">Input</div><p>{node.input_summary}</p></>}
        </section>
      )}
      <section className="timing-grid">
        <div><Clock3 size={13} /><span>Started</span><b>{formatTime(node.started_at)}</b></div>
        <div><Clock3 size={13} /><span>Duration</span><b>{formatDuration(node)}</b></div>
      </section>
      {metrics.length > 0 && (
        <section>
          <div className="section-label">Impact</div>
          <div className="metric-list">
            {metrics.map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
          </div>
        </section>
      )}
      {(node.artifacts.length > 0 || (node.output_summary?.evidence_ids.length ?? 0) > 0) && (
        <section>
          <div className="section-label">Evidence</div>
          {node.output_summary?.evidence_ids.map((id) => <code className="evidence-id" key={id}>{id}</code>)}
          {node.artifacts.map((artifact, index) => <ArtifactBlock artifact={artifact} key={`${artifact.name}-${index}`} />)}
        </section>
      )}
      {node.removal_reason && (
        <section className="removal-reason">
          <div className="section-label">Why this step was removed</div>
          <p>{node.removal_reason}</p>
        </section>
      )}
      {blocked && <InstructionBox data={data} />}
    </div>
  )
}

function FlowCard({ data }: { data: FlowNodeData }) {
  const node = data.runtimeNode
  const primaryMetric = getPrimaryMetric(node.output_summary?.metrics ?? {})
  const title = node.output_summary?.headline ?? node.label
  const classes = [
    'flow-card',
    statusClass(data.displayStatus),
    data.expanded ? 'expanded' : '',
    data.visiblyActive ? 'visibly-active' : '',
  ].filter(Boolean).join(' ')
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      data.onToggle()
    }
  }
  return (
    <div
      aria-expanded={data.expanded}
      className={classes}
      onClick={data.onToggle}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
    >
      <Handle type="target" position={Position.Left} />
      <div className="card-header">
        <span className="owner"><UserRound size={12} /> {node.agent_label ?? 'Donald'}</span>
        <span className="status"><StatusMark status={data.displayStatus} /> {data.displayStatus}</span>
      </div>
      <h2>{title}</h2>
      {primaryMetric && <div className="primary-metric"><span>{primaryMetric.label}</span><strong>{primaryMetric.value}</strong></div>}
      {data.liveStatus && <p className="live-status"><i />{data.liveStatus.text}</p>}
      {data.expanded && <ExpandedDetails data={data} />}
      <span className="expand-hint">{data.expanded ? 'Click to collapse' : 'Click to inspect'}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function FlowNodeRenderer(props: NodeProps) {
  const data = props.data as unknown as FlowNodeData
  const shellRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const element = shellRef.current
    if (!element) return
    const publish = () => data.onResize({ width: element.offsetWidth, height: element.offsetHeight })
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data])
  const style = {
    '--node-enter-delay': `${data.appearance.delayMs}ms`,
    width: data.expanded ? `${EXPANDED_SIZE.width}px` : `${COLLAPSED_SIZE.width}px`,
  } as CSSProperties
  return (
    <div
      className={`flow-node-shell born ${data.appearance.discovered ? 'discovered' : ''}`}
      ref={shellRef}
      style={style}
    >
      <FlowCard data={data} />
    </div>
  )
}

export function RunViewer({ requestedRunKey }: { requestedRunKey: string | null }) {
  const initialKey = requestedRunKey ?? 'latest'
  const [state, setState] = useState(() => createInitialRunState(initialKey))
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [streamOpen, setStreamOpen] = useState(true)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [instructionError, setInstructionError] = useState<string | null>(null)
  const [submittingNodeKey, setSubmittingNodeKey] = useState<string | null>(null)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [sourceGeneration, setSourceGeneration] = useState(0)
  const [measuredSizes, setMeasuredSizes] = useState<Record<string, MeasuredNodeSize>>({})
  const sourceRef = useRef<DonaldEventSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const readPromiseRef = useRef<Promise<DonaldEvent | null> | null>(null)
  const layoutRef = useRef<Record<string, LayoutPosition>>({})
  if (!sourceRef.current) sourceRef.current = createSource(requestedRunKey)

  const readNext = useCallback((): Promise<DonaldEvent | null> => {
    if (readPromiseRef.current) return readPromiseRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const source = sourceRef.current
    if (!source) return Promise.resolve(null)
    const promise = (async () => {
      try {
        const result = await source.next({ signal: controller.signal })
        if (result.done) return null
        const event = result.value
        setState((current) => applyEvent(current, event))
        if (event.event_type === 'intervention_requested' && event.node_key) setExpandedKey(event.node_key)
        setSourceError(null)
        return event
      } catch (error: unknown) {
        if (controller.signal.aborted) return null
        setSourceError(error instanceof Error ? error.message : 'Runtime source failed')
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
    if (state.open_intervention) return
    let cancelled = false
    void (async () => {
      while (!cancelled) {
        const event = await readNext()
        if (!event || event.event_type === 'intervention_requested') break
      }
    })()
    return () => { cancelled = true }
  }, [readNext, sourceGeneration, state.open_intervention])

  useEffect(() => () => abortRef.current?.abort(), [])

  const nodeSizes = useMemo(() => Object.fromEntries(Object.keys(state.nodes).map((key) => {
    const expanded = expandedKey === key
    const measured = measuredSizes[key]
    return [key, measured?.expanded === expanded ? measured : expanded ? EXPANDED_SIZE : COLLAPSED_SIZE]
  })), [expandedKey, measuredSizes, state.nodes])

  const structuralSignature = useMemo(() => [
    ...Object.values(state.nodes).map((node) => `${node.node_key}:${node.removed}`).sort(),
    ...Object.values(state.edges).map((edge) => `${edge.edge_key}:${edge.status}`).sort(),
    ...Object.entries(nodeSizes).map(([key, size]) => `${key}:${size.width}:${size.height}`).sort(),
  ].join('|'), [nodeSizes, state.edges, state.nodes])

  const layout = useMemo(() => {
    const next = layoutGraph(state.nodes, state.edges, layoutRef.current, nodeSizes)
    layoutRef.current = next
    return next
  }, [structuralSignature])

  const graphPresentation = useMemo(() => getGraphPresentation(state.event_log), [state.event_log])
  const visiblyActiveKey = useMemo(
    () => getVisiblyActiveNodeKey(state.nodes, state.event_log),
    [state.event_log, state.nodes],
  )

  const updateMeasurement = useCallback((nodeKey: string, expanded: boolean, size: NodeSize) => {
    setMeasuredSizes((current) => {
      const previous = current[nodeKey]
      if (previous && previous.expanded === expanded && previous.width === size.width && previous.height === size.height) return current
      return { ...current, [nodeKey]: { ...size, expanded } }
    })
  }, [])

  const submitInstruction = useCallback(async (node: RunNode, instruction: string, optionId?: string | null) => {
    setSubmittingNodeKey(node.node_key)
    setInstructionError(null)
    try {
      const event = await postOperatorInstruction(API_BASE_URL, state.run.key, {
        nodeKey: node.node_key,
        instruction,
        optionId,
        currentSequence: state.last_sequence,
      })
      setState((current) => applyEvent(current, event))
    } catch (error: unknown) {
      setInstructionError(error instanceof Error ? error.message : 'Instruction could not be queued')
    } finally {
      setSubmittingNodeKey(null)
    }
  }, [state.last_sequence, state.run.key])

  const visualNodes: Node[] = useMemo(() => Object.values(state.nodes).map((node) => {
    const expanded = expandedKey === node.node_key
    const intervention = state.open_intervention?.node_key === node.node_key ? state.open_intervention : null
    const size = nodeSizes[node.node_key]
    return {
      id: node.node_key,
      type: 'flow',
      position: { x: layout[node.node_key].x, y: layout[node.node_key].y },
      width: size.width,
      height: size.height,
      style: { width: size.width },
      data: {
        runtimeNode: node,
        displayStatus: displayStatus(node),
        expanded,
        visiblyActive: visiblyActiveKey === node.node_key,
        appearance: graphPresentation.nodes[node.node_key] ?? { delayMs: 0, discovered: false, batch: 0 },
        liveStatus: visiblyActiveKey === node.node_key ? getLatestNodeStatus(node, state.event_log) : null,
        intervention,
        instructionLifecycle: getInstructionLifecycle(state.event_log, node.node_key),
        instructionError: expanded ? instructionError : null,
        submitting: submittingNodeKey === node.node_key,
        onToggle: () => setExpandedKey((current) => current === node.node_key ? null : node.node_key),
        onResize: (measured) => updateMeasurement(node.node_key, expanded, measured),
        onInstruction: (instruction, optionId) => submitInstruction(node, instruction, optionId),
      } satisfies FlowNodeData,
    }
  }), [expandedKey, graphPresentation.nodes, instructionError, layout, nodeSizes, state.event_log, state.nodes, state.open_intervention, submitInstruction, submittingNodeKey, updateMeasurement, visiblyActiveKey])

  const visualEdges: Edge[] = useMemo(() => Object.values(state.edges)
    .filter((edge) => state.nodes[edge.source_node_key] && state.nodes[edge.target_node_key])
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
    }), [graphPresentation.edges, state.edges, state.nodes, visiblyActiveKey])

  const zoomToFit = useCallback(() => {
    const bounds = getLayoutBounds(layout, nodeSizes)
    if (!bounds || !flowInstance) return
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420
    void flowInstance.fitBounds(bounds, { padding: 0.12, duration })
  }, [flowInstance, layout, nodeSizes])

  useEffect(() => {
    zoomToFit()
  }, [zoomToFit])

  const reset = useCallback(async () => {
    abortRef.current?.abort()
    await readPromiseRef.current
    sourceRef.current = createSource(requestedRunKey)
    layoutRef.current = {}
    setState(createInitialRunState(initialKey))
    setExpandedKey(null)
    setMeasuredSizes({})
    setSourceError(null)
    setInstructionError(null)
    setSourceGeneration((generation) => generation + 1)
  }, [initialKey, requestedRunKey])

  const latestEvents = [...state.event_log].reverse().slice(0, 7)
  const latestReplan = getLatestReplan(state.event_log)
  const latestRecalculation = getLatestRecalculation(state.event_log)
  const request = getRunRequest(state.run)

  return (
    <main className="donald">
      <header className="header">
        <div className="brand"><img src="/donald-logo-official.png" alt="Donald" /></div>
        <div className="request-heading">
          <span>Operator request</span>
          <h1>{request}</h1>
        </div>
        <div className="run-summary">
          <span><i className="live-dot" />{runStatusLabel(state)}</span>
          <code>{state.run.key}</code>
          <small>{state.event_log.length} events · revision {state.run.graph_revision}</small>
        </div>
        <button className="reset-button" onClick={() => void reset()} type="button"><RotateCcw size={14} /> Reset</button>
      </header>

      <section className="canvas-panel">
        {latestRecalculation && (
          <div className={`replan-overlay ${latestRecalculation.kind}`} key={latestRecalculation.key}>
            <div className="recalculating">Recalculating…</div>
            {latestReplan && (
              <div className="replan-cause">
                REPLAN · {latestReplan.reason}
                {latestReplan.evidenceIds.length > 0 && ` · ${latestReplan.evidenceIds.join(', ')}`}
              </div>
            )}
          </div>
        )}
        {sourceError && <div className="source-error"><AlertTriangle size={14} />{sourceError}</div>}
        <ReactFlow
          edges={visualEdges}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1.25 }}
          minZoom={0.18}
          nodeTypes={nodeTypes}
          nodes={visualNodes}
          nodesConnectable={false}
          nodesDraggable={false}
          onInit={setFlowInstance}
          onPaneClick={() => setExpandedKey(null)}
          onlyRenderVisibleElements={false}
          panOnDrag
          style={{ width: '100%', height: '100%' }}
          zoomOnDoubleClick={false}
        />
      </section>

      <footer className={`event-stream ${streamOpen ? 'open' : ''}`}>
        <button className="stream-toggle" onClick={() => setStreamOpen((open) => !open)} type="button">
          <span><i className="live-dot" /> Live event stream <small>{state.event_log.length} events</small></span>
          {streamOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {streamOpen && (
          <div className="events">
            {latestEvents.map((event) => (
              <div className="event" key={event.idempotency_key}>
                <code>{formatTime(event.occurred_at)}</code><span>{eventDescription(event)}</span>
              </div>
            ))}
          </div>
        )}
      </footer>
    </main>
  )
}
