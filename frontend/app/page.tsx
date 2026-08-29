'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
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
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import { getActionImpact, getPetComment } from '@/data/action-impact'
import { ActionImpactDetail } from '@/components/donald/action-impact-detail'
import { PetComment } from '@/components/donald/pet-comment'
import { NodeActivationEffect } from '@/components/donald/node-activation-effect'
import { RuntimeEdge, type RuntimeEdgeData, type RuntimeEdgeStatus } from '@/components/donald/runtime-edge'
import { DonaldPet } from '@/components/donald-pet/DonaldPet'
import '@xyflow/react/dist/style.css'

type Status = 'WAITING' | 'RUNNING' | 'DONE' | 'NEEDS HUMAN' | 'BLOCKED' | 'FAILED' | 'SKIPPED'
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

type CapabilityStep = {
  capability: Capability
  status: Status
  output: string
  current: string
  task: string
  nextTask?: string
  detail?: Record<string, string>
}
type FlowNode = {
  id: string
  title?: string
  capability?: Capability
  capabilities?: Capability[]
  agent: string
  role: string
  output: string
  phase: string
  status: Status
  detail: Record<string, string>
  steps?: CapabilityStep[]
  x: number
  y: number
}
type Handoff = { edgeId: string; targetId: string; targetStatus: Status; key: number; phase: 'travel' | 'activate' }
type FlowNodeData = FlowNode & {
  selected: boolean
  activating: boolean
  activationKey: number
  petMoving: boolean
  onSelect: () => void
  onActivationComplete: () => void
}
type Cursor = { nodeIndex: number; stepIndex: number } | null

const makeStep = (
  capability: Capability,
  task: string,
  output: string,
  current: string,
  nextTask?: string,
  detail?: Record<string, string>,
): CapabilityStep => ({ capability, status: 'WAITING', output, current, task, nextTask, detail })

const initialNodes: FlowNode[] = [
  {
    id: 'document-understanding',
    title: 'DOCUMENT UNDERSTANDING',
    capabilities: ['INGEST', 'IDENTIFY', 'EXTRACT'],
    agent: 'Alec',
    role: 'Document / Compliance',
    output: 'Carrier event received',
    phase: 'UNDERSTAND',
    status: 'WAITING',
    detail: { Source: 'Carrier API', Payload: 'Shipment update', Attachment: 'carrier-event-9382.json' },
    steps: [
      makeStep('INGEST', 'Read carrier email', 'Carrier event received', 'Reading carrier API event...', 'Identify shipment', { Source: 'Carrier API', Received: '11:18:02' }),
      makeStep('IDENTIFY', 'Match shipment entities', 'Matched to OP-2048', 'Matching shipment entities...', 'Extract ETA change', { Operation: 'OP-2048', Customer: 'Liverpool', Confidence: '98%' }),
      makeStep('EXTRACT', 'Extract ETA change', 'ETA Sep 18 -> Sep 27', 'Extracting ETA and vessel data...', 'Monitor shipment', { 'Previous ETA': 'Sep 18', 'New ETA': 'Sep 27', Location: 'Busan' }),
    ],
    x: 60,
    y: 150,
  },
  {
    id: 'shipment-watch',
    title: 'SHIPMENT WATCH',
    capabilities: ['MONITOR', 'PREDICT', 'DETECT'],
    agent: 'Nina',
    role: 'Shipment Watch',
    output: 'Shipment state updated',
    phase: 'WATCH & DETECT',
    status: 'WAITING',
    detail: { Current: 'Live shipment state', Changes: 'Busan transshipment event' },
    steps: [
      makeStep('MONITOR', 'Monitor shipment', 'Shipment state updated', 'Watching shipment state...', 'Forecast delay risk', { 'Last checked': '11:18:05', Changes: 'Busan transshipment event' }),
      makeStep('PREDICT', 'Forecast delay risk', '9-day delay forecast', 'Forecasting delay risk...', 'Detect anomalies', { Forecast: '9-day delay', Confidence: '87%', 'SLA risk': 'HIGH' }),
      makeStep('DETECT', 'Detect anomalies', 'Unexpected transshipment detected', 'Checking for anomalies...', 'Analyze root cause', { Exception: 'Unexpected transshipment', Severity: 'HIGH' }),
    ],
    x: 620,
    y: 150,
  },
  {
    id: 'root-cause-impact',
    title: 'ROOT CAUSE & IMPACT',
    capabilities: ['EXPLAIN', 'IMPACT'],
    agent: 'Rex / Recovery',
    role: 'Root Cause / Recovery Planning',
    output: 'Root cause analysis',
    phase: 'UNDERSTAND THE PROBLEM',
    status: 'WAITING',
    detail: { Evidence: '3 sources', Customer: 'Liverpool' },
    steps: [
      makeStep('EXPLAIN', 'Analyze root cause', 'Root cause analysis', 'Analyzing root cause...', 'Calculate exposure', { 'Root cause': 'Missed vessel connection in Busan', Confidence: '94%' }),
      makeStep('IMPACT', 'Calculate exposure', 'Business impact calculated', 'Calculating financial exposure...', 'Generate recovery options', { 'Operational exposure': '$18,400', 'POs affected': '12' }),
    ],
    x: 1180,
    y: 150,
  },
  {
    id: 'resolution',
    title: 'RESOLUTION',
    capabilities: ['PLAN', 'DECIDE', 'ACT'],
    agent: 'Recovery / Human / Lex',
    role: 'Resolution',
    output: '3 recovery options generated',
    phase: 'RESOLVE',
    status: 'WAITING',
    detail: { Recommended: 'Approve alternative route', Impact: '$18,400 operational exposure' },
    steps: [
      makeStep('PLAN', 'Generate recovery options', '3 recovery options generated', 'Ranking recovery options...', 'Human approval', { 'Option A': 'Keep current route', 'Option B': 'Alternative route', Recommended: 'Option B' }),
      makeStep('DECIDE', 'Await human decision', 'Human approval required', 'Waiting for human approval...', 'Execute approved reroute', { Problem: 'ETA delayed 9 days', Recommendation: 'Approve alternative route' }),
      makeStep('ACT', 'Execute approved reroute', 'Execute approved action', 'Executing approved reroute...', undefined, { Action: 'Execute approved action', Result: 'Waiting for decision' }),
    ],
    x: 1740,
    y: 150,
  },
]

const baseEdges: Edge[] = initialNodes.slice(0, -1).map((node, index) => ({
  id: `e-${node.id}`,
  source: node.id,
  target: initialNodes[index + 1].id,
  type: 'signal',
}))

function edgeSourceId(edgeId: string) {
  return edgeId.replace(/^e-/, '')
}

function getSteps(node: FlowNode) {
  return node.steps ?? (node.capability ? [makeStep(node.capability, node.output, node.output, `${node.capability.toLowerCase()} running...`, undefined, node.detail)] : [])
}

function deriveNode(node: FlowNode, steps: CapabilityStep[]): FlowNode {
  const active = steps.find((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN')
  const doneCount = steps.filter((step) => step.status === 'DONE' || step.status === 'SKIPPED').length
  const status = active?.status ?? (doneCount === steps.length && steps.length > 0 ? 'DONE' : 'WAITING')
  return { ...node, steps, status, output: active?.output ?? [...steps].reverse().find((step) => step.status === 'DONE')?.output ?? node.output }
}

function completedCount(node: FlowNode) {
  return getSteps(node).filter((step) => step.status === 'DONE' || step.status === 'SKIPPED').length
}

function progressPercent(node: FlowNode) {
  const steps = getSteps(node)
  if (!steps.length) return 0
  const done = completedCount(node)
  if (done === steps.length) return 100
  const activeIndex = steps.findIndex((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN')
  return Math.round(((done + (activeIndex >= 0 ? 0.62 : 0)) / steps.length) * 100)
}

function displayTask(node: FlowNode) {
  const steps = getSteps(node)
  const active = steps.find((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN')
  const latestDone = [...steps].reverse().find((step) => step.status === 'DONE')
  if (completedCount(node) === steps.length && steps.length > 0) return `${node.title ?? node.capability} complete`
  return active?.task ?? latestDone?.task ?? steps[0]?.task ?? node.output
}

function nextTask(node: FlowNode) {
  const steps = getSteps(node)
  if (completedCount(node) === steps.length && steps.length > 0) return 'COMPLETE'
  const active = steps.find((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN')
  const waiting = steps.find((step) => step.status === 'WAITING')
  return active?.nextTask ?? waiting?.task ?? 'COMPLETE'
}

function preferredCapability(node: FlowNode) {
  const steps = getSteps(node)
  return (
    steps.find((step) => step.status === 'RUNNING') ??
    steps.find((step) => step.status === 'NEEDS HUMAN') ??
    [...steps].reverse().find((step) => step.status === 'DONE') ??
    steps[0]
  )?.capability ?? null
}

function activeCapability(node: FlowNode) {
  return getSteps(node).find((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN')?.capability
}

function operationalExposure(node: FlowNode) {
  const values = [
    node.detail.Impact,
    ...getSteps(node).flatMap((step) => Object.values(step.detail ?? {})),
  ]
  return values.join(' ').match(/\$[\d,]+/)?.[0]
}

function ArcBeacon() {
  return <span className="arc-beacon" aria-hidden="true"><i /></span>
}

function CapabilityMark({ status }: { status: Status }) {
  if (status === 'RUNNING') return <ArcBeacon />
  if (status === 'DONE') return <Check size={11} />
  if (status === 'NEEDS HUMAN') return <AlertTriangle size={11} />
  return <CircleDot size={9} />
}

function StatusBadge({ status }: { status: Status }) {
  const icon = status === 'RUNNING' ? <ArcBeacon /> : <CapabilityMark status={status} />
  return <span className={`status status-${status.replace(' ', '-').toLowerCase()}`}>{icon}{status}</span>
}

function StatusRail({ node }: { node: FlowNode }) {
  const steps = getSteps(node)
  if (steps.length <= 1) return null
  return (
    <div className="status-rail" aria-hidden="true">
      {steps.map((step) => (
        <span className={`rail-dot rail-dot-${step.status.replace(' ', '-').toLowerCase()}`} key={step.capability}><CapabilityMark status={step.status} /></span>
      ))}
    </div>
  )
}

function FlowCard({
  data,
  selected,
  activating,
  activationKey,
  petMoving,
  onSelect,
  onActivationComplete,
}: {
  data: FlowNode
  selected: boolean
  activating: boolean
  activationKey: number
  petMoving: boolean
  onSelect: () => void
  onActivationComplete: () => void
}) {
  const steps = getSteps(data)
  const pct = progressPercent(data)
  const petCapability = preferredCapability(data) ?? undefined
  const petAssetCapability = activeCapability(data)
  const petComment = petCapability ? getPetComment(petCapability, data.status, { isMoving: petMoving, operationalExposure: operationalExposure(data) }) : null
  const showPet = Boolean(petAssetCapability) || petMoving || data.status === 'RUNNING' || data.status === 'NEEDS HUMAN' || data.status === 'FAILED'
  const showPetComment = petMoving || data.status === 'RUNNING' || data.status === 'NEEDS HUMAN' || data.status === 'FAILED'
  return (
    <div className={`flow-card ${data.status.toLowerCase().replace(' ', '-')} ${selected ? 'selected' : ''} ${activating ? 'activating' : ''}`} onClick={onSelect}>
      <NodeActivationEffect active={activating} effectKey={activationKey} onComplete={onActivationComplete} />
      <StatusRail node={data} />
      {showPet && (
        <div className="pet-companion">
          {showPetComment && petComment && <PetComment comment={petComment} />}
          <div className="donald-pet-anchor">
            <DonaldPet capability={petAssetCapability ?? petCapability} status={data.status} isMoving={petMoving} size={70} />
          </div>
        </div>
      )}
      <div className="flow-card-content">
        <Handle type="target" position={Position.Left} />
        <div className="card-top">
          <span className="capability">{data.title ?? data.capability ?? steps[0]?.capability}</span>
        </div>
        <div className="task-meta">
          <span>TASK</span>
          {data.status === 'RUNNING' && <ArcBeacon />}
          <b>{pct}%</b>
        </div>
        <div className="task-title">{displayTask(data)}</div>
        <div className="node-progress-line"><i style={{ width: `${pct}%` }} /></div>
        <div className="next-task">{nextTask(data) === 'COMPLETE' ? <b>COMPLETE</b> : <><span>NEXT TASK</span><b>{nextTask(data)}</b></>}</div>
        <Handle type="source" position={Position.Right} />
      </div>
    </div>
  )
}

function FlowNodeRenderer(props: NodeProps) {
  const data = props.data as unknown as FlowNodeData
  return (
    <FlowCard
      data={data}
      selected={data.selected}
      activating={data.activating}
      activationKey={data.activationKey}
      petMoving={data.petMoving}
      onSelect={data.onSelect}
      onActivationComplete={data.onActivationComplete}
    />
  )
}

const edgeTypes = { signal: RuntimeEdge }
const nodeTypes = { flow: FlowNodeRenderer }

export default function Page() {
  const [nodes, setNodes] = useState(initialNodes)
  const [selected, setSelected] = useState('resolution')
  const [selectedCapability, setSelectedCapability] = useState<Capability | null>('PLAN')
  const [running, setRunning] = useState(false)
  const [cursor, setCursor] = useState<Cursor>(null)
  const [events, setEvents] = useState<string[]>(['11:18:02  Alec received carrier update', '11:18:03  Matched update to OP-2048'])
  const [streamOpen, setStreamOpen] = useState(true)
  const [added, setAdded] = useState(false)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)

  const active = nodes.find((node) => node.id === selected) ?? nodes[0]
  const activeSteps = getSteps(active)
  const inspectorStep = activeSteps.find((step) => step.capability === selectedCapability) ?? activeSteps.find((step) => step.status === 'RUNNING' || step.status === 'NEEDS HUMAN') ?? activeSteps[0]
  const humanPaused = nodes.some((node) => getSteps(node).some((step) => step.status === 'NEEDS HUMAN'))
  const selectedPetMoving = handoff?.phase === 'travel' && (handoff.targetId === active.id || edgeSourceId(handoff.edgeId) === active.id)
  const inspectorActiveCapability = activeCapability(active)
  const inspectorPetAssetCapability = inspectorStep?.capability === 'INGEST' ? inspectorStep.capability : inspectorActiveCapability
  const inspectorImpact = inspectorStep ? getActionImpact(inspectorStep.capability) : null
  const decisionImpact = getActionImpact('DECIDE')

  const startNode = useCallback((nodeIndex: number, stepIndex = 0) => {
    setNodes((current) => current.map((node, index) => {
      if (index !== nodeIndex) return node
      const steps = getSteps(node).map((step, i) => ({ ...step, status: i < stepIndex ? 'DONE' : i === stepIndex ? (step.capability === 'DECIDE' ? 'NEEDS HUMAN' : 'RUNNING') : 'WAITING' as Status }))
      return deriveNode(node, steps)
    }))
  }, [])

  const completeActivation = useCallback(() => {
    setHandoff((current) => {
      if (!current || current.phase !== 'activate') return current
      const nodeIndex = nodes.findIndex((node) => node.id === current.targetId)
      setCursor({ nodeIndex, stepIndex: 0 })
      startNode(nodeIndex, 0)
      if (current.targetStatus === 'NEEDS HUMAN') setRunning(false)
      return null
    })
  }, [nodes, startNode])

  const selectNode = useCallback((node: FlowNode) => {
    setSelected(node.id)
    setSelectedCapability(preferredCapability(node))
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    flowInstance?.setCenter(node.x + 136, node.y + 89, { zoom: 1.42, duration })
  }, [flowInstance])

  const visualNodes: Node[] = useMemo(() => nodes.map((node) => ({
    id: node.id,
    type: 'flow',
    position: { x: node.x, y: node.y },
    data: {
      ...node,
      selected: selected === node.id,
      activating: handoff?.targetId === node.id && handoff.phase === 'activate',
      activationKey: handoff?.key ?? 0,
      petMoving: handoff?.phase === 'travel' && (handoff.targetId === node.id || edgeSourceId(handoff.edgeId) === node.id),
      onSelect: () => selectNode(node),
      onActivationComplete: completeActivation,
    },
  })), [nodes, selected, handoff, selectNode, completeActivation])

  const visualEdges = useMemo(() => baseEdges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)
    const target = nodes.find((node) => node.id === edge.target)
    const status: RuntimeEdgeStatus =
      handoff?.edgeId === edge.id && handoff.phase === 'travel' ? 'ACTIVE' :
      handoff?.edgeId === edge.id ? 'DONE' :
      source?.status === 'FAILED' || target?.status === 'FAILED' ? 'FAILED' :
      source?.status === 'SKIPPED' || target?.status === 'SKIPPED' ? 'SKIPPED' :
      target?.status === 'BLOCKED' ? 'BLOCKED' :
      source?.status === 'DONE' ? 'DONE' :
      'WAITING'
    const data: RuntimeEdgeData = {
      status,
      signalKey: handoff?.key ?? 0,
      selected: selected === edge.source || selected === edge.target,
    }
    return { ...edge, data }
  }), [nodes, handoff, selected])

  const advance = useCallback(() => {
    if (handoff) return
    if (humanPaused) return

    const current = cursor
    if (!current) {
      setCursor({ nodeIndex: 0, stepIndex: 0 })
      startNode(0, 0)
      setSelected(nodes[0].id)
      setSelectedCapability(getSteps(nodes[0])[0]?.capability ?? null)
      setEvents((list) => [...list, `11:18:04  ${nodes[0].agent} ${getSteps(nodes[0])[0]?.current.toLowerCase()}`])
      return
    }

    const node = nodes[current.nodeIndex]
    const steps = getSteps(node)
    const nextStepIndex = current.stepIndex + 1

    setNodes((currentNodes) => currentNodes.map((item, index) => {
      if (index !== current.nodeIndex) return item
      const updatedSteps = getSteps(item).map((step, i) => ({ ...step, status: i <= current.stepIndex ? 'DONE' : i === nextStepIndex ? (step.capability === 'DECIDE' ? 'NEEDS HUMAN' : 'RUNNING') : 'WAITING' as Status }))
      return deriveNode(item, updatedSteps)
    }))

    if (nextStepIndex < steps.length) {
      const nextStep = steps[nextStepIndex]
      setCursor({ nodeIndex: current.nodeIndex, stepIndex: nextStepIndex })
      setSelectedCapability(nextStep.capability)
      setEvents((list) => [...list, `11:18:${String(5 + current.nodeIndex + nextStepIndex).padStart(2, '0')}  ${node.agent} ${nextStep.current.toLowerCase()}`])
      if (nextStep.capability === 'DECIDE') setRunning(false)
      return
    }

    const nextNode = nodes[current.nodeIndex + 1]
    if (!nextNode) {
      setRunning(false)
      return
    }

    setCursor(null)
    setHandoff({ edgeId: `e-${node.id}`, targetId: nextNode.id, targetStatus: 'RUNNING', key: Date.now(), phase: 'travel' })
    setSelected(nextNode.id)
    setSelectedCapability(getSteps(nextNode)[0]?.capability ?? null)
    setEvents((list) => [...list, `11:18:${String(8 + current.nodeIndex).padStart(2, '0')}  Signal handed to ${nextNode.title ?? nextNode.id}`])
  }, [cursor, handoff, humanPaused, nodes, startNode])

  useEffect(() => {
    if (!running || handoff) return
    const t = setTimeout(advance, 1080)
    return () => clearTimeout(t)
  }, [running, handoff, advance])

  useEffect(() => {
    if (!handoff || handoff.phase !== 'travel') return
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 800
    const t = setTimeout(() => setHandoff((current) => current && current.key === handoff.key ? { ...current, phase: 'activate' } : current), delay)
    return () => clearTimeout(t)
  }, [handoff])

  const reset = () => {
    setRunning(false)
    setCursor(null)
    setNodes(initialNodes)
    setSelected('resolution')
    setSelectedCapability('PLAN')
    setEvents(['11:18:02  Alec received carrier update', '11:18:03  Matched update to OP-2048'])
    setHandoff(null)
  }

  const zoomToFit = () => {
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    flowInstance?.fitView({ padding: .18, duration })
  }

  const approve = () => {
    const resolutionIndex = nodes.findIndex((node) => node.id === 'resolution')
    setNodes((current) => current.map((node) => {
      if (node.id !== 'resolution') return node
      const steps = getSteps(node).map((step) => step.capability === 'DECIDE' ? { ...step, status: 'DONE' as Status, output: 'Alternative route approved', detail: { ...step.detail, Decision: 'Alternative route approved' } } : step.capability === 'ACT' ? { ...step, status: 'RUNNING' as Status, output: 'Executing approved action' } : step)
      return deriveNode(node, steps)
    }))
    setCursor({ nodeIndex: resolutionIndex, stepIndex: 2 })
    setSelected('resolution')
    setSelectedCapability('ACT')
    setEvents((list) => [...list, '11:18:30  Human decision received', '11:18:31  Lex executing approved action'])
  }

  const addBL = () => {
    if (added) return
    setAdded(true)
    const bl: FlowNode = {
      id: 'bl-validation',
      capability: 'RECONCILE',
      agent: 'Alec',
      role: 'Compliance',
      output: 'Vessel mismatch',
      phase: 'ESTABLISH TRUTH',
      status: 'WAITING',
      detail: { 'DOCUMENT COMPARISON': 'Booking - MSC Aurora / Bill of Lading - MSC Aries', Mismatch: 'Vessel', Actions: 'Request correction - Accept - View evidence' },
      x: 620,
      y: 390,
    }
    setNodes((list) => [...list.slice(0, 1), bl, ...list.slice(1).map((node) => ({ ...node, x: node.x + 560 }))])
    setSelected('bl-validation')
    setSelectedCapability('RECONCILE')
    setEvents((list) => [...list, '11:19:02  Flow changed - BL validation inserted'])
  }

  const showHumanDecision = active.id === 'resolution' && getSteps(active).some((step) => step.capability === 'DECIDE' && step.status === 'NEEDS HUMAN')

  return (
    <main className="donald">
      <header className="header">
        <div className="brand"><img className="brand-logo" src="/donald-logo-official.png" alt="Donald" /></div>
        <div className="run-meta">
          <div><span className="meta-label">ORGANIZATION</span>Muebles del Sur</div>
          <div><span className="meta-label">FLOW</span>Booking Monitoring</div>
          <div><span className="meta-label">OPERATION</span><code>OP-2048</code></div>
          <div><span className="meta-label">RUN</span><code>#3482</code></div>
          <div className="run-state"><span className="live-dot" />RUNNING</div>
        </div>
      </header>

      <section className="toolbar">
        <div className="crumb"><Crosshair size={15} /> LIVE RUN VIEWER <span>/</span> <b>Booking Monitoring</b></div>
        <div className="controls">
          <button className="text-btn"><span className="live-dot" /> FOLLOW LIVE</button>
          <button onClick={() => setRunning(true)} disabled={running || humanPaused} className="dark-btn"><Play size={14} /> PLAY</button>
          <button onClick={() => setRunning(false)} className="dark-btn"><Pause size={14} /> PAUSE</button>
          <button onClick={advance} className="dark-btn"><ArrowRight size={14} /> NEXT STEP</button>
          <button onClick={reset} className="icon-btn" aria-label="Reset"><RotateCcw size={15} /></button>
        </div>
      </section>

      <div className="workspace">
        <section className="canvas-panel">
          <div className="canvas-label"><div className="canvas-title"><button className="fit-view-btn" onClick={zoomToFit} aria-label="Zoom out to full workflow"><Scan size={14} /></button><span>EXECUTION GRAPH</span></div><span className="mono">LIVE · {events.length} EVENTS</span></div>
          <div className="flow-wrap">
            <ReactFlow nodes={visualNodes} edges={visualEdges} edgeTypes={edgeTypes} nodeTypes={nodeTypes} onInit={setFlowInstance} fitView fitViewOptions={{ padding: .18 }} proOptions={{ hideAttribution: true }} nodesDraggable={false} nodesConnectable={false}>
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="network-points" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
            <div className="phase-key">{['UNDERSTAND', 'ESTABLISH TRUTH', 'WATCH & DETECT', 'UNDERSTAND THE PROBLEM', 'RESOLVE'].map((phase) => <span key={phase}><i /> {phase}</span>)}</div>
          </div>
        </section>

        <aside className={`inspector ${showHumanDecision ? 'human' : ''}`}>
          <div className="inspector-head">
            <div><div className="eyebrow">NODE INSPECTOR</div><h2>{active.title ?? active.capability}</h2></div>
            <DonaldPet className="inspector-pet" capability={inspectorPetAssetCapability ?? inspectorStep?.capability} status={active.status} isMoving={selectedPetMoving} size={88} />
            <button className="close-btn"><X size={15} /></button>
          </div>

          {showHumanDecision ? (
            <div className="decision">
              <div className="needs"><AlertTriangle size={18} /> DECISION REQUIRED</div>
              <h1>Decision required</h1>
              <p>Operation <code>OP-2048</code> for customer Liverpool is delayed 9 days.</p>
              <div className="impact-box"><span>OPERATIONAL EXPOSURE</span><strong>$18,400</strong><small>Recommendation: Approve alternative route</small></div>
              <section className="inspector-impact-section">
                <ActionImpactDetail impact={decisionImpact} />
              </section>
              <div className="options">
                <div><b>KEEP CURRENT ROUTE</b><span>ETA Sep 27 · Additional cost $0</span></div>
                <div className="recommended"><b>APPROVE ALTERNATIVE</b><span>ETA Sep 22 · Additional cost $1,840</span></div>
                <div><b>NOTIFY CLIENT ONLY</b><span>Send customer update without rerouting</span></div>
              </div>
              <button className="approve" onClick={approve}><Check size={16} /> APPROVE ALTERNATIVE</button>
              <div className="secondary-actions"><button onClick={approve}>KEEP CURRENT</button><button onClick={approve}>NOTIFY CLIENT</button></div>
            </div>
          ) : (
            <div className="detail">
              <div className="detail-status"><StatusBadge status={active.status} /><span><UserRound size={13} /> {active.agent} · {active.role}</span></div>
              {activeSteps.length > 1 && (
                <section>
                  <label>CAPABILITIES</label>
                  <div className="inspector-capabilities">
                    {activeSteps.map((step) => (
                      <button className={selectedCapability === step.capability ? 'selected' : ''} key={step.capability} onClick={() => setSelectedCapability(step.capability)}>
                        <span>{step.capability}</span><b><CapabilityMark status={step.status} /> {step.status}</b>
                        {step.status === 'DONE' && <small>Output: {step.output}</small>}
                        {step.status === 'RUNNING' && <small>Current: {step.current}</small>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="timing"><div><span>STARTED</span><code>11:18:0{Math.max(2, events.length)}</code></div><div><span>DURATION</span><code>{active.status === 'DONE' ? '2.4s' : '-'}</code></div></div>
              <section><label>INPUT</label><p>{inspectorStep?.capability === 'INGEST' ? 'Carrier event' : 'Operational context from previous step'}</p></section>
              <section><label>OUTPUT</label><p className="output-large">{inspectorStep?.status === 'RUNNING' ? inspectorStep.current : inspectorStep?.output ?? active.output}</p></section>
              <section><label>EVIDENCE</label>{Object.entries(inspectorStep?.detail ?? active.detail).map(([key, value]) => <div className="kv" key={key}><span>{key}</span><b>{value}</b></div>)}</section>
              {inspectorImpact && (
                <section className="inspector-impact-section">
                  <ActionImpactDetail impact={inspectorImpact} />
                </section>
              )}
              {inspectorStep?.capability === 'DETECT' && <div className="warning"><AlertTriangle size={15} /> High severity exception</div>}
            </div>
          )}
        </aside>
      </div>

      <footer className={`event-stream ${streamOpen ? 'open' : ''}`}>
        <button className="stream-toggle" onClick={() => setStreamOpen(!streamOpen)}>
          <div><span className="live-dot" /> LIVE EVENT STREAM <span className="event-count">{events.length} EVENTS</span></div>
          {streamOpen ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        {streamOpen && <div className="events">{events.slice(-8).map((event, index) => <div className="event" key={`${event}-${index}`}><code>{event.slice(0, 8)}</code><span>{event.slice(10)}</span></div>)}</div>}
      </footer>

      <div className="demo-menu"><button onClick={addBL}><FileCheck2 size={15} /> {added ? 'BL VALIDATION ADDED' : 'ADD BL VALIDATION STEP'}</button></div>
    </main>
  )
}
