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
  ExternalLink,
  FileText,
  Hand,
  Minus,
  Send,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import {
  Background,
  BackgroundVariant,
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
  FIT_PADDING,
  getFitViewport,
  getLayoutBounds,
  getVisibleNodeViewport,
  layoutGraph,
  MAX_FIT_ZOOM,
  MIN_FIT_ZOOM,
  type LayoutPosition,
  type NodeSize,
} from '@/lib/donald/layout'
import {
  canIntervene,
  getAutomationSaving,
  getGraphPresentation,
  getLatestArtifact,
  getLatestNodeStatus,
  getLatestRecalculation,
  getLatestReplan,
  getNodeInterventions,
  getPrimaryMetric,
  getRunRequest,
  getSubtaskPresentation,
  getRunSavings,
  getVisiblyActiveNodeKey,
  metricRows,
  shouldShowInstructionForm,
  type LiveNodeStatus,
  type NodePresentation,
} from '@/lib/donald/presentation'
import { applyEvent, createInitialRunState } from '@/lib/donald/reduce'
import {
  fetchPromptSuggestions,
  liveSource,
  postOperatorInstruction,
  recordedSource,
  type DonaldEventSource,
  type PromptSuggestion,
} from '@/lib/donald/source'
import { RunControls } from '@/components/donald/run-controls'
import { ClientArea } from '@/components/donald/client-area'
import { DonaldNarration } from '@/components/donald/donald-narration'
import { OperationalStageAccordion, stageDomId } from '@/components/donald/operational-stage'
import { ActionAnimation } from '@/components/donald/animations/action-animation'
import {
  actionPresentationForNode,
  type ActionPresentation,
} from '@/lib/donald/action-presentation'
import type { ActionAnimationState } from '@/components/donald/animations/action-animation-registry'
import {
  clientProjectMetadata,
  operationalStageForNode,
  summarizeOperationalStages,
  type OperationalStageId,
  type OperationalStageSummary,
} from '@/lib/donald/operational-stages'
import type {
  DonaldEvent,
  InterventionOption,
  InterventionRecord,
  OpenIntervention,
  RunArtifact,
  RunEdge,
  RunNode,
  RunState,
  RunSubtask,
} from '@/lib/donald/types'
import '@xyflow/react/dist/style.css'

type DisplayStatus = 'PROPOSED' | 'WAITING' | 'RUNNING' | 'DONE' | 'NEEDS HUMAN' | 'BLOCKED' | 'FAILED' | 'SKIPPED' | 'REMOVED'

type InstructionKind = 'stop' | 'steer'

/** Why a read ended. See readNext for why this is not just `event | null`. */
type ReadOutcome =
  | { status: 'event'; event: DonaldEvent }
  | { status: 'aborted' }
  | { status: 'error' }
  | { status: 'done' }

type FlowNodeData = {
  runtimeNode: RunNode
  displayStatus: DisplayStatus
  actionPresentation: ActionPresentation
  selected: boolean
  visiblyActive: boolean
  appearance: NodePresentation
  liveStatus: LiveNodeStatus | null
  intervention: OpenIntervention | null
  interventions: InterventionRecord[]
  steerable: boolean
  instructionError: string | null
  submitting: boolean
  suggestions: PromptSuggestion[]
  onToggle: () => void
  onResize: (size: NodeSize) => void
  onInstruction: (instruction: string, options?: { optionId?: string | null; kind?: InstructionKind }) => Promise<void>
}

const API_BASE_URL = process.env.NEXT_PUBLIC_DONALD_API ?? null
const COLLAPSED_SIZE: NodeSize = { width: 380, height: 230 }
// A replay is compressed to about this long, whatever the run really took, with
// every gap kept proportional inside it.
const REPLAY_TARGET_MS = 45_000
// The floor is what stops a replay flickering. Events in a real run can land
// milliseconds apart; replaying them that way flips edge and node states a dozen
// times a second, which no amount of easing can make readable. A quarter second
// is the shortest gap that still reads as one change at a time.
const REPLAY_MIN_GAP_MS = 250
const REPLAY_MAX_GAP_MS = 1_600
// How coarsely the graph's extent is measured before the camera reacts to it.
// One card width: smaller than a new column, larger than any text reflow.
const VIEWPORT_QUANTUM = 380
// Fallback matching .node-drawer while it mounts. The rendered width is measured
// before moving the camera because the drawer becomes full-width on small screens.
const DRAWER_WIDTH = 430
// Framing: a little breathing room, and a zoom ceiling so a one-node run does
// not open magnified to fill the screen and then crawl back out as work arrives.
const edgeTypes = { signal: RuntimeEdge }
const nodeTypes = { flow: FlowNodeRenderer }
const STAGE_GRAPH_MIN_HEIGHT = 360

// The pitch demos are recordings and everything else is live. The named
// recordings stay served from the bundle so the stage demo cannot depend on
// the backend, while any other run key - an agent working right now, a run a
// judge just asked for - streams from the real API and accepts interventions.
const RECORDED_RUNS = new Set(['missing-invoice', 'replan', 'land-pickup', 'berrios-op4471'])

function createSource(runKey: string | null): DonaldEventSource {
  const recorded = runKey === null || RECORDED_RUNS.has(runKey)
  if (!API_BASE_URL || recorded) return recordedSource({ recording: runKey })
  return liveSource(API_BASE_URL, runKey)
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

/**
 * Move the camera, and animate it in CSS.
 *
 * React Flow's own animation is unusable here: setViewport, fitView and
 * fitBounds all resolve without moving anything when given a non-zero duration,
 * while the identical call with duration 0 applies instantly and correctly. That
 * silent failure is why the graph sat unfitted and ran off the right of the
 * screen — every camera call this app made passed a duration, so not one of them
 * ever took effect, and nothing reported an error.
 *
 * So the position is applied instantly and the smoothing is a CSS transition on
 * the viewport, switched on only for the length of a programmatic move. Leaving
 * it on permanently would put the same easing on hand-panning, which turns a
 * drag into a laggy chase.
 */
function moveCamera(
  instance: ReactFlowInstance,
  container: HTMLElement | null,
  target: { x: number; y: number; zoom: number },
) {
  const viewport = container?.querySelector<HTMLElement>('.react-flow__viewport')
  const duration = motionDuration(420)
  if (viewport && duration > 0) {
    viewport.classList.add('camera-moving')
    window.setTimeout(() => viewport.classList.remove('camera-moving'), duration + 60)
  }
  void instance.setViewport(target, { duration: 0 })
}

/** Honours the reduced-motion preference in one place. */
function motionDuration(milliseconds: number): number {
  if (typeof window === 'undefined') return 0
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds
}

function statusClass(status: DisplayStatus): string {
  return status.toLowerCase().replace(' ', '-')
}

function animationState(status: DisplayStatus): ActionAnimationState {
  switch (status) {
    case 'RUNNING': return 'running'
    case 'DONE': return 'done'
    case 'NEEDS HUMAN':
    case 'BLOCKED': return 'blocked'
    case 'FAILED': return 'failed'
    default: return 'waiting'
  }
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

function declaredAgent(events: readonly DonaldEvent[], preferredLabel?: string): string | null {
  for (const event of events) {
    if (event.event_type !== 'run_started') continue
    const agents = event.payload.agents
    if (!Array.isArray(agents)) continue
    const labels = agents.flatMap((agent) => {
      if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return []
      const label = (agent as Record<string, unknown>).label
      return typeof label === 'string' && label.trim() ? [label.trim()] : []
    })
    if (preferredLabel && labels.includes(preferredLabel)) return preferredLabel
    return labels[0] ?? null
  }
  return null
}

function latestRunAgent(events: readonly DonaldEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const agentLabel = events[index].agent_label
    if (agentLabel) return agentLabel
  }
  return null
}

function currentAgentName(nodes: Record<string, RunNode>, activeNodeKey: string | null, events: readonly DonaldEvent[]): string | null {
  if (activeNodeKey) return nodes[activeNodeKey]?.agent_label ?? null
  return latestRunAgent(events) ?? declaredAgent(events)
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
      {artifact.url && (
        <a className="artifact-link" href={artifact.url} onClick={(event) => event.stopPropagation()} rel="noreferrer noopener" target="_blank">
          <ExternalLink size={11} /> Open
        </a>
      )}
    </article>
  )
}

function InstructionTrail({ record }: { record: InterventionRecord }) {
  const milestones = [
    { status: 'queued', label: 'Queued', time: record.queued_at, reached: true },
    { status: 'delivered', label: 'Agent saw it', time: record.delivered_at, reached: Boolean(record.delivered_at) },
    { status: 'resolved', label: 'Acted on', time: record.resolved_at, reached: Boolean(record.resolved_at) },
  ]
  const headline = record.status === 'queued'
    ? 'Queued — the agent has not picked this up yet'
    : record.status === 'delivered'
      ? 'The agent has seen this and is acting on it'
      : record.outcome === 'failed'
        ? 'The agent could not comply'
        : 'Done'
  return (
    <div className="instruction-state" aria-live="polite">
      <strong>{headline}</strong>
      <p className="instruction-echo">
        {record.type === 'stop' ? 'STOP · ' : 'STEER · '}{record.prompt}
      </p>
      <div className="instruction-milestones">
        {milestones.map((milestone) => (
          <div className={milestone.reached ? 'reached' : ''} key={milestone.status}>
            <i aria-hidden="true" />
            <span>{milestone.label}</span>
            <time>{milestone.time ? formatTime(milestone.time) : 'Pending'}</time>
          </div>
        ))}
      </div>
      {record.response && <p className="instruction-response">“{record.response}”</p>}
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
  const [customInstructionKey, setCustomInstructionKey] = useState<string | null>(null)
  const options = [...(data.intervention?.options ?? [])].sort((left, right) =>
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER),
  )
  const gateKey = data.intervention?.id ?? data.runtimeNode.node_key
  const showInstructionForm = shouldShowInstructionForm(options.length, customInstructionKey === gateKey)
  const pending = data.interventions.find((record) => record.status !== 'resolved') ?? null
  const busy = data.submitting || Boolean(pending)

  const send = (kind: InstructionKind) => {
    const value = instruction.trim()
    if (!value) return
    void data.onInstruction(value, { kind })
    setInstruction('')
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
                disabled={busy}
                key={option.id}
                onChoose={(selected) => void data.onInstruction(selected.label, { optionId: selected.id })}
                option={option}
              />
            ))}
            {options.length === 0 && (
              <button
                className="acknowledge"
                disabled={busy}
                onClick={() => void data.onInstruction('Acknowledged')}
                type="button"
              >
                Acknowledge
              </button>
            )}
          </div>
          {!showInstructionForm && (
            <button
              aria-expanded="false"
              className="custom-instruction-toggle"
              onClick={() => setCustomInstructionKey(gateKey)}
              type="button"
            >
              Or give a custom instruction…
            </button>
          )}
        </>
      )}

      {!data.intervention && (
        <div className="section-label">
          <Hand size={13} /> {data.displayStatus === 'PROPOSED' || data.displayStatus === 'WAITING'
            ? 'Change this before it runs'
            : 'Take over this step'}
        </div>
      )}

      {showInstructionForm && (
        <>
          {data.suggestions.length > 0 && !busy && (
            <div className="suggestions">
              <span className="suggestions-label"><Sparkles size={11} /> Suggested</span>
              <div className="suggestion-chips">
                {data.suggestions.map((suggestion) => (
                  <button
                    className="suggestion-chip"
                    key={suggestion.label}
                    onClick={(event) => { event.stopPropagation(); setInstruction(suggestion.prompt) }}
                    title={suggestion.prompt}
                    type="button"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form className="instruction-form" onSubmit={(event) => { event.preventDefault(); send('steer') }}>
            <label htmlFor={`instruction-${data.runtimeNode.node_key}`}>
              {data.displayStatus === 'PROPOSED' || data.displayStatus === 'WAITING'
                ? 'Tell the agent how to do this step'
                : 'Give the agent an instruction'}
            </label>
            <textarea
              disabled={busy}
              id={`instruction-${data.runtimeNode.node_key}`}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Type a concrete instruction for this step…"
              rows={3}
              value={instruction}
            />
            <div className="instruction-actions">
              {/* Stop and steer are the same channel with different intent, so they
                  share one box. Both are advisory - the agent honours them on its
                  next check - and the wording says so rather than implying a kill
                  switch we do not have. */}
              <button
                className="steer"
                disabled={!instruction.trim() || busy}
                type="submit"
              >
                <Send size={13} /> Steer
              </button>
              <button
                className="stop"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation()
                  void data.onInstruction(
                    instruction.trim() || `Stop ${data.runtimeNode.label} and do not continue with it.`,
                    { kind: 'stop' },
                  )
                  setInstruction('')
                }}
                type="button"
              >
                Stop this step
              </button>
            </div>
          </form>
        </>
      )}

      {data.interventions.map((record) => <InstructionTrail key={record.id} record={record} />)}
      {data.instructionError && <p className="instruction-error">{data.instructionError}</p>}
    </section>
  )
}

function ArtifactList({ node }: { node: RunNode }) {
  const evidenceIds = node.output_summary?.evidence_ids ?? []
  if (node.artifacts.length === 0 && evidenceIds.length === 0) return null
  return (
    <section>
      <div className="section-label">Evidence</div>
      {evidenceIds.map((id) => <code className="evidence-id" key={id}>{id}</code>)}
      {node.artifacts.map((artifact, index) => (
        <ArtifactBlock artifact={artifact} key={`${artifact.name}-${index}`} />
      ))}
    </section>
  )
}

function ExpandedDetails({ data }: { data: FlowNodeData }) {
  const node = data.runtimeNode
  const metrics = metricRows(node.output_summary?.metrics ?? {})
  const saving = getAutomationSaving(node)
  const finding = node.output_summary?.detail
  return (
    <div className="card-details" onClick={(event) => event.stopPropagation()}>
      {node.description && (
        <section>
          <div className="section-label">What this step does</div>
          <p>{node.description}</p>
        </section>
      )}

      {(node.tool_name || node.node_type) && (
        <section className="node-meta">
          {node.tool_name && <span><Wrench size={11} /> {node.tool_name}</span>}
          {node.node_type && <span className="node-kind">{node.node_type.replaceAll('_', ' ')}</span>}
        </section>
      )}

      {/* A failure the agent explained and the UI threw away was the worst gap
          in this panel: a red card reading FAILED with no reason, while the
          explanation sat in the database. */}
      {node.error_message && (
        <section className="failure">
          <div className="section-label"><AlertTriangle size={13} /> Why it failed</div>
          <p>{node.error_message}</p>
        </section>
      )}

      {node.status.startsWith('blocked_on_') && node.status_message && !node.error_message && (
        <section className="blocked-reason">
          <div className="section-label"><AlertTriangle size={13} /> What it is waiting for</div>
          <p>{node.status_message}</p>
        </section>
      )}

      {(finding || node.input_summary) && (
        <section>
          {finding && <><div className="section-label">Finding</div><p>{finding}</p></>}
          {node.input_summary && <><div className="section-label secondary">Input</div><p>{node.input_summary}</p></>}
        </section>
      )}

      {/* The card shows a six-item window; the drawer is where there is room for
          all of them. Without this, opening the drawer on a step with subtasks
          showed strictly LESS than the collapsed card behind it. */}
      {node.subtasks && node.subtasks.length > 0 && (
        <section>
          <div className="section-label">Work inside this step</div>
          <SubtaskList subtasks={node.subtasks} complete />
        </section>
      )}

      <section className="timing-grid">
        <div><Clock3 size={13} /><span>Started</span><b>{formatTime(node.started_at)}</b></div>
        <div><Clock3 size={13} /><span>Duration</span><b>{formatDuration(node)}</b></div>
      </section>

      {saving && (
        <section className="saving">
          <div className="section-label">Saved by automating this</div>
          <div className="saving-figures">
            <div><span>Human time</span><strong>{saving.humanTime}</strong></div>
            <div><span>Cost</span><strong>{saving.money}</strong></div>
          </div>
          {/* The basis is shown, not hidden. A savings number whose arithmetic
              you cannot see is a claim; one that shows its rate is an argument. */}
          <small className="saving-basis">{saving.basis}</small>
        </section>
      )}

      {metrics.length > 0 && (
        <section>
          <div className="section-label">Impact</div>
          <div className="metric-list">
            {metrics.map((metric) => <div key={metric.key}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
          </div>
        </section>
      )}

      <ArtifactList node={node} />

      {node.removal_reason && (
        <section className="removal-reason">
          <div className="section-label">Why this step was removed</div>
          <p>{node.removal_reason}</p>
        </section>
      )}

      {(data.steerable || data.interventions.length > 0) && <InstructionBox data={data} />}
    </div>
  )
}

/**
 * The detail panel, beside the graph rather than inside it.
 *
 * A person watching a live run has built a spatial map of the work; the run
 * keeps going while they read one step. Expanding in place destroyed that map at
 * exactly the moment they were trying to use it. A drawer keeps the graph
 * geometrically frozen, keeps the whole run visible while one step is read, and
 * gives the detail a real reading column instead of 430px of squeezed card.
 */
function NodeDrawer({ data, onClose }: { data: FlowNodeData; onClose: () => void }) {
  const node = data.runtimeNode
  return (
    <aside aria-label={`Details for ${node.label}`} className="node-drawer">
      <header className="drawer-header">
        <div>
          <span className="owner"><UserRound size={12} /> {node.agent_label ?? 'Donald'}</span>
          <span className={`status ${statusClass(data.displayStatus)}`}>
            <StatusMark status={data.displayStatus} /> {data.displayStatus}
          </span>
        </div>
        <h2>{node.output_summary?.headline ?? node.label}</h2>
        <code>{node.node_key}</code>
        <button aria-label="Close details" className="drawer-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </header>
      <div className="drawer-body">
        <ExpandedDetails data={data} />
      </div>
    </aside>
  )
}

function FlowCard({ data }: { data: FlowNodeData }) {
  const node = data.runtimeNode
  const latestArtifact = getLatestArtifact(node.artifacts)
  const primaryMetric = getPrimaryMetric(node.output_summary?.metrics ?? {})
  const saving = getAutomationSaving(node)
  const pendingIntervention = data.interventions.find((record) => record.status !== 'resolved') ?? null
  const title = node.output_summary?.headline ?? node.label
  const classes = [
    'flow-card',
    `action-${data.actionPresentation.id}`,
    statusClass(data.displayStatus),
    data.selected ? 'selected' : '',
    data.visiblyActive ? 'visibly-active' : '',
    pendingIntervention ? 'steered' : '',
  ].filter(Boolean).join(' ')
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      data.onToggle()
    }
  }
  return (
    <div
      aria-pressed={data.selected}
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
      <ActionAnimation
        presentation={data.actionPresentation}
        state={animationState(data.displayStatus)}
      />
      {primaryMetric && <div className="primary-metric"><span>{primaryMetric.label}</span><strong>{primaryMetric.value}</strong></div>}
      {saving && (
        <div className="card-saving" title={saving.basis}>
          <span>Saved</span><strong>{saving.humanTime}</strong><em>{saving.money}</em>
        </div>
      )}
      {data.liveStatus && <p className="live-status"><i />{data.liveStatus.text}</p>}
      {node.subtasks && node.subtasks.length > 0 && <SubtaskList subtasks={node.subtasks} />}
      {pendingIntervention && (
        <p className="card-instruction"><Hand size={11} /> {pendingIntervention.type === 'stop' ? 'Stop' : 'Steer'} sent — {pendingIntervention.status === 'queued' ? 'waiting for the agent' : 'agent has it'}</p>
      )}
      {latestArtifact && (
        <div className="card-artifact" title={latestArtifact.name}>
          <FileText aria-hidden="true" size={12} />
          <span>{latestArtifact.name}</span>
        </div>
      )}
      <span className="expand-hint">
        {data.selected ? 'Showing details' : data.steerable ? 'Click to inspect or steer' : 'Click to inspect'}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const SUBTASK_WINDOW = 6

// The window follows the work instead of cutting from the head. With ten
// subtasks and the first six done, a fixed slice(0, 6) showed six struck-through
// lines and hid the only one actually running — the reason the list exists.
function subtaskWindowStart(subtasks: RunSubtask[]): number {
  if (subtasks.length <= SUBTASK_WINDOW) return 0
  const focus = subtasks.findIndex((s) => s.status === 'running' || s.status === 'failed')
  if (focus < 0) return Math.max(0, subtasks.length - SUBTASK_WINDOW)
  // Keep a line of finished context above the live one where there is room.
  return Math.min(Math.max(0, focus - 1), subtasks.length - SUBTASK_WINDOW)
}

function SubtaskList({ subtasks, complete = false }: { subtasks: RunSubtask[]; complete?: boolean }) {
  const start = complete ? 0 : subtaskWindowStart(subtasks)
  const visibleSubtasks = complete ? subtasks : subtasks.slice(start, start + SUBTASK_WINDOW)
  const hiddenBefore = start
  const hiddenAfter = subtasks.length - start - visibleSubtasks.length
  return (
    <ul className={complete ? 'subtask-list subtask-list-complete' : 'subtask-list'}>
      {hiddenBefore > 0 && <li className="subtask-more">+{hiddenBefore} done</li>}
      {visibleSubtasks.map((subtask) => {
        const appearance = getSubtaskPresentation(subtask.status)
        return (
          <li
            className={`subtask-item subtask-${appearance.tone} ${appearance.struck ? 'subtask-struck' : ''}`}
            key={subtask.key}
          >
            <span className={`subtask-icon subtask-icon-${appearance.icon}`} role="img" aria-label={`${subtask.status} subtask`}>
              {appearance.icon === 'check' && <Check size={12} aria-hidden="true" />}
              {appearance.icon === 'minus' && <Minus size={12} aria-hidden="true" />}
              {appearance.icon === 'x' && <X size={12} aria-hidden="true" />}
            </span>
            <span className="subtask-label">{subtask.label}</span>
          </li>
        )
      })}
      {hiddenAfter > 0 && <li className="subtask-more">+{hiddenAfter} more</li>}
    </ul>
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
  // One width, always. Selection is a ring, not a size change — see NodeDrawer.
  const style = {
    '--node-enter-delay': `${data.appearance.delayMs}ms`,
    width: `${COLLAPSED_SIZE.width}px`,
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

function nodesForStage(stage: OperationalStageSummary, nodes: Record<string, RunNode>): Record<string, RunNode> {
  return Object.fromEntries(stage.nodeKeys.flatMap((nodeKey) => {
    const node = nodes[nodeKey]
    return node ? [[nodeKey, node]] : []
  }))
}

function edgesForStage(
  stage: OperationalStageSummary,
  nodes: Record<string, RunNode>,
  edges: Record<string, RunEdge>,
): Record<string, RunEdge> {
  const stageKeys = new Set(stage.nodeKeys)
  return Object.fromEntries(Object.entries(edges).filter(([, edge]) =>
    stageKeys.has(edge.source_node_key) &&
    stageKeys.has(edge.target_node_key) &&
    nodes[edge.source_node_key] &&
    nodes[edge.target_node_key],
  ))
}

function crossStageTransitions(
  stage: OperationalStageSummary,
  stages: OperationalStageSummary[],
  nodes: Record<string, RunNode>,
  edges: Record<string, RunEdge>,
): string[] {
  const stageByNode = new Map(stages.flatMap((candidate) =>
    candidate.nodeKeys.map((nodeKey) => [nodeKey, candidate] as const),
  ))
  const labels = new Set<string>()
  for (const edge of Object.values(edges)) {
    if (!stage.nodeKeys.includes(edge.source_node_key)) continue
    const targetStage = stageByNode.get(edge.target_node_key)
    if (!targetStage || targetStage.id === stage.id) continue
    if (!nodes[edge.source_node_key] || !nodes[edge.target_node_key]) continue
    labels.add(targetStage.id === 'below' ? 'Signal / trigger below the line' : `Continues to ${targetStage.eyebrow}`)
  }
  return [...labels]
}

export function RunViewer({ requestedRunKey }: { requestedRunKey: string | null }) {
  const initialKey = requestedRunKey ?? 'latest'
  const [state, setState] = useState(() => createInitialRunState(initialKey))
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [streamOpen, setStreamOpen] = useState(true)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [instructionError, setInstructionError] = useState<string | null>(null)
  const [submittingNodeKey, setSubmittingNodeKey] = useState<string | null>(null)
  const [flowInstances, setFlowInstances] = useState<Partial<Record<OperationalStageId, ReactFlowInstance>>>({})
  // Set the moment the person pans or zooms by hand. From then on the canvas is
  // theirs: an agent adding a node must not move a camera someone is holding.
  const [viewportPinned, setViewportPinned] = useState(false)
  const [sourceGeneration, setSourceGeneration] = useState(0)
  const [measuredSizes, setMeasuredSizes] = useState<Record<string, NodeSize>>({})
  const [suggestions, setSuggestions] = useState<Record<string, PromptSuggestion[]>>({})
  const [replaying, setReplaying] = useState(false)
  const [stageExpansionOverrides, setStageExpansionOverrides] = useState<Partial<Record<OperationalStageId, boolean>>>({})
  const replayingRef = useRef(false)
  const replayTimerRef = useRef<number | null>(null)
  const sourceRef = useRef<DonaldEventSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const readPromiseRef = useRef<Promise<ReadOutcome> | null>(null)
  const layoutRef = useRef<Partial<Record<OperationalStageId, Record<string, LayoutPosition>>>>({})
  const stageCanvasRefs = useRef<Partial<Record<OperationalStageId, HTMLElement | null>>>({})
  if (!sourceRef.current) sourceRef.current = createSource(requestedRunKey)

  /**
   * One read from the source, reporting WHY it ended rather than just "nothing".
   *
   * The previous version returned `DonaldEvent | null` and the loop broke on
   * null, which conflated three unrelated things: the stream genuinely ending,
   * a transient failure, and an abort. React's development double-mount aborts
   * the first read and immediately restarts the loop, so the restarted loop
   * would collect the aborted read's `null` and stop for good — the page sat at
   * CONNECTING with zero events and made no network request at all, because the
   * only reader had already given up. Naming the outcome is what makes "the
   * component remounted" recoverable and "the run is over" final.
   */
  const readNext = useCallback((): Promise<ReadOutcome> => {
    if (readPromiseRef.current) return readPromiseRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const source = sourceRef.current
    if (!source) return Promise.resolve({ status: 'done' })
    const promise = (async (): Promise<ReadOutcome> => {
      try {
        const result = await source.next({ signal: controller.signal })
        if (result.done) return { status: 'done' }
        const event = result.value
        setState((current) => applyEvent(current, event))
        if (event.event_type === 'intervention_requested' && event.node_key) setExpandedKey(event.node_key)
        setSourceError(null)
        return { status: 'event', event }
      } catch (error: unknown) {
        if (controller.signal.aborted) return { status: 'aborted' }
        setSourceError(error instanceof Error ? error.message : 'Runtime source failed')
        return { status: 'error' }
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
    // A replay is re-folding the log from scratch; letting the live reader write
    // into the same state at the same time would interleave two timelines.
    if (replaying) return
    let cancelled = false
    void (async () => {
      while (!cancelled) {
        const outcome = await readNext()
        if (cancelled) break
        // An abort belongs to a reader that is being replaced, not to the run.
        // Loop round and open a fresh read; the source resumes from its cursor.
        if (outcome.status === 'aborted') continue
        if (outcome.status === 'done') break
        if (outcome.status === 'error') break
        if (outcome.event.event_type === 'intervention_requested') break
      }
    })()
    return () => { cancelled = true }
  }, [readNext, replaying, sourceGeneration, state.open_intervention])

  useEffect(() => () => abortRef.current?.abort(), [])

  /**
   * Card sizes, which selection no longer affects.
   *
   * Cards used to grow from 300x190 to 430x650 in place. Because a column's
   * pitch is set by its widest card and a column is centred on its own total
   * height, opening one card slid its siblings apart, pushed every downstream
   * column sideways, swung the edges attached to it, and forced the camera to
   * zoom out — all while the run carried on behind the disruption. The detail
   * moved to a drawer precisely so that reading one step cannot destroy the map
   * of the whole run, which is the thing the person is there to watch.
   */
  const nodeSizes = useMemo(() => Object.fromEntries(Object.keys(state.nodes).map((key) => {
    const measured = measuredSizes[key]
    return [key, measured ?? COLLAPSED_SIZE]
  })), [measuredSizes, state.nodes])

  const structuralSignature = useMemo(() => [
    ...Object.values(state.nodes).map((node) => `${node.node_key}:${node.removed}`).sort(),
    ...Object.values(state.edges).map((edge) => `${edge.edge_key}:${edge.status}`).sort(),
    ...Object.entries(nodeSizes).map(([key, size]) => `${key}:${size.width}:${size.height}`).sort(),
  ].join('|'), [nodeSizes, state.edges, state.nodes])

  const graphPresentation = useMemo(() => getGraphPresentation(state.event_log), [state.event_log])
  const visiblyActiveKey = useMemo(
    () => getVisiblyActiveNodeKey(state.nodes, state.event_log),
    [state.event_log, state.nodes],
  )
  const stageSummaries = useMemo(() => summarizeOperationalStages(state.nodes), [state.nodes])
  const stageLayouts = useMemo(() => {
    const next: Partial<Record<OperationalStageId, Record<string, LayoutPosition>>> = {}
    for (const stage of stageSummaries) {
      const stageNodes = nodesForStage(stage, state.nodes)
      const stageEdges = edgesForStage(stage, state.nodes, state.edges)
      next[stage.id] = layoutGraph(stageNodes, stageEdges, layoutRef.current[stage.id] ?? {}, nodeSizes)
    }
    layoutRef.current = next
    return next
  }, [nodeSizes, stageSummaries, state.edges, state.nodes, structuralSignature])
  const activeStageId = useMemo(() => {
    if (visiblyActiveKey && state.nodes[visiblyActiveKey]) return operationalStageForNode(state.nodes[visiblyActiveKey])
    return stageSummaries.find((stage) => stage.state === 'needs-human')?.id ??
      stageSummaries.find((stage) => stage.id === 'below' && stage.state === 'in-progress')?.id ??
      stageSummaries.find((stage) => stage.state === 'in-progress')?.id ??
      null
  }, [stageSummaries, state.nodes, visiblyActiveKey])
  const expandedStageIds = useMemo(() => new Set(stageSummaries.flatMap((stage) => {
    const override = stageExpansionOverrides[stage.id]
    const expanded = override ?? (
      stage.id === activeStageId ||
      stage.state === 'needs-human' ||
      (stage.id === 'below' && stage.state === 'in-progress')
    )
    return expanded ? [stage.id] : []
  })), [activeStageId, stageExpansionOverrides, stageSummaries])
  const toggleStage = useCallback((stageId: OperationalStageId) => {
    setStageExpansionOverrides((current) => ({
      ...current,
      [stageId]: !expandedStageIds.has(stageId),
    }))
  }, [expandedStageIds])

  const updateMeasurement = useCallback((nodeKey: string, size: NodeSize) => {
    setMeasuredSizes((current) => {
      const previous = current[nodeKey]
      if (previous && previous.width === size.width && previous.height === size.height) return current
      return { ...current, [nodeKey]: size }
    })
  }, [])

  const submitInstruction = useCallback(async (
    node: RunNode,
    instruction: string,
    options: { optionId?: string | null; kind?: InstructionKind } = {},
  ) => {
    setSubmittingNodeKey(node.node_key)
    setInstructionError(null)
    try {
      const event = await postOperatorInstruction(API_BASE_URL, state.run.key, {
        nodeKey: node.node_key,
        instruction,
        optionId: options.optionId,
        type: options.kind ?? 'steer',
        currentSequence: state.last_sequence,
      })
      setState((current) => applyEvent(current, event))
    } catch (error: unknown) {
      setInstructionError(error instanceof Error ? error.message : 'Instruction could not be queued')
    } finally {
      setSubmittingNodeKey(null)
    }
  }, [state.last_sequence, state.run.key])

  /**
   * Suggestions are fetched for the card that is OPEN, and only that one.
   *
   * Generating them for every node up front would bill an LLM call per step of
   * a graph nobody has clicked on. They are keyed by graph revision as well as
   * node so that reopening the same card during the same state of the run
   * returns the server's cached answer rather than re-rolling the wording.
   */
  useEffect(() => {
    if (!expandedKey) return
    const node = state.nodes[expandedKey]
    if (!node || !canIntervene(node)) return
    const key = `${expandedKey}:${state.run.graph_revision}`
    if (suggestions[key]) return

    const controller = new AbortController()
    void fetchPromptSuggestions(API_BASE_URL, state.run.key, expandedKey, { signal: controller.signal })
      .then((fetched) => {
        if (controller.signal.aborted || fetched.length === 0) return
        setSuggestions((current) => ({ ...current, [key]: fetched }))
      })
    return () => controller.abort()
  }, [expandedKey, state.nodes, state.run.graph_revision, state.run.key, suggestions])

  const stageGraphs = useMemo(() => stageSummaries.map((stage) => {
    const stageLayout = stageLayouts[stage.id] ?? {}
    const stageNodes = nodesForStage(stage, state.nodes)
    const stageEdges = edgesForStage(stage, state.nodes, state.edges)
    const nodes: Node[] = Object.values(stageNodes).flatMap((node) => {
      const position = stageLayout[node.node_key]
      if (!position) return []
      const selected = expandedKey === node.node_key
      const intervention = state.open_intervention?.node_key === node.node_key ? state.open_intervention : null
      const size = nodeSizes[node.node_key]
      const display = displayStatus(node)
      return [{
        id: node.node_key,
        type: 'flow',
        position: { x: position.x, y: position.y },
        width: size.width,
        height: size.height,
        style: { width: size.width },
        data: {
          runtimeNode: node,
          displayStatus: display,
          actionPresentation: actionPresentationForNode({
            nodeKey: node.node_key,
            label: node.label,
            nodeType: node.node_type,
          }),
          selected,
          visiblyActive: visiblyActiveKey === node.node_key,
          appearance: graphPresentation.nodes[node.node_key] ?? { delayMs: 0, discovered: false, batch: 0 },
          liveStatus: visiblyActiveKey === node.node_key ? getLatestNodeStatus(node, state.event_log) : null,
          intervention,
          interventions: getNodeInterventions(state.interventions, node.node_key),
          steerable: canIntervene(node),
          instructionError: selected ? instructionError : null,
          submitting: submittingNodeKey === node.node_key,
          suggestions: suggestions[`${node.node_key}:${state.run.graph_revision}`] ?? [],
          onToggle: () => setExpandedKey((current) => current === node.node_key ? null : node.node_key),
          onResize: (measured) => updateMeasurement(node.node_key, measured),
          onInstruction: (instruction, instructionOptions) => submitInstruction(node, instruction, instructionOptions),
        } satisfies FlowNodeData,
      }]
    })
    const edges: Edge[] = Object.values(stageEdges).map((edge) => {
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
      return {
        id: edge.edge_key,
        source: edge.source_node_key,
        target: edge.target_node_key,
        type: 'signal',
        data: {
          status,
          enterDelayMs: graphPresentation.edges[edge.edge_key]?.delayMs ?? 0,
          exiting,
        } satisfies RuntimeEdgeData,
      }
    })
    const bounds = getLayoutBounds(stageLayout, nodeSizes)
    const height = bounds ? Math.max(STAGE_GRAPH_MIN_HEIGHT, bounds.y + bounds.height + 72) : STAGE_GRAPH_MIN_HEIGHT
    return {
      stage,
      nodes,
      edges,
      height,
      transitions: crossStageTransitions(stage, stageSummaries, state.nodes, state.edges),
    }
  }), [expandedKey, graphPresentation.edges, graphPresentation.nodes, nodeSizes, stageLayouts, stageSummaries, state.edges, state.event_log, state.interventions, state.nodes, state.open_intervention, state.run.graph_revision, submitInstruction, submittingNodeKey, suggestions, updateMeasurement, visiblyActiveKey])

  const allVisualNodes = useMemo(() => stageGraphs.flatMap((stage) => stage.nodes), [stageGraphs])

  const selectedNodeData = useMemo(
    () => (allVisualNodes.find((node) => node.id === expandedKey)?.data as FlowNodeData | undefined) ?? null,
    [allVisualNodes, expandedKey],
  )

  useEffect(() => {
    if (!expandedKey) return
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setExpandedKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedKey])

  /**
   * Frame a stage graph using OUR layout, not React Flow's.
   *
   * Both fitView and fitBounds silently did nothing here: they size the graph
   * from each node's `measured` field, which React Flow populates from its own
   * ResizeObserver, and for these nodes it stayed undefined — so the call
   * resolved without moving the camera and the graph hung off the right of the
   * screen with no error anywhere. We already compute exact positions and sizes
   * in layoutGraph, so the arithmetic here is authoritative and needs nothing
   * from the library's measurement lifecycle. It also lets the zoom ceiling
   * actually apply, which fitBounds does not support at all.
   */
  const zoomStageToFit = useCallback((stageId: OperationalStageId) => {
    const bounds = getLayoutBounds(stageLayouts[stageId] ?? {}, nodeSizes)
    const instance = flowInstances[stageId]
    const container = stageCanvasRefs.current[stageId]
    if (!bounds || !instance || !container) return
    const { width, height } = container.getBoundingClientRect()
    if (width === 0 || height === 0) return

    moveCamera(instance, container, getFitViewport(bounds, { width, height }))
  }, [flowInstances, nodeSizes, stageLayouts])

  const zoomToFit = useCallback(() => {
    const expandedStages = stageSummaries.filter((stage) => expandedStageIds.has(stage.id) && stage.totalActions > 0)
    const orderedStages = [
      ...expandedStages.filter((stage) => stage.id === activeStageId),
      ...expandedStages.filter((stage) => stage.id !== activeStageId),
    ]
    for (const stage of orderedStages) zoomStageToFit(stage.id)
    if (activeStageId) {
      document.getElementById(stageDomId(activeStageId))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeStageId, expandedStageIds, stageSummaries, zoomStageToFit])

  /**
   * The camera follows the EXTENT of the graph, quantised.
   *
   * It used to depend on the whole zoomToFit closure, which changes whenever any
   * node is measured — so it re-fit on every one of a run's ~90 events, each fit
   * interrupting the last before it arrived, and every card click yanked the
   * person out to the full graph at a new zoom.
   *
   * Keying on the node and edge KEYS alone fixed the clicking but under-fit: the
   * keys are final before the cards have been measured, so the one fit that
   * mattered ran against stale sizes and the right-hand column hung off the
   * screen. Rounding the bounds to a coarse grid keeps both properties — a
   * status line rewrapping does not move the camera, a column of new work does.
   */
  const viewportKey = useMemo(() => {
    const q = (value: number) => Math.round(value / VIEWPORT_QUANTUM)
    return stageSummaries.map((stage) => {
      const bounds = getLayoutBounds(stageLayouts[stage.id] ?? {}, nodeSizes)
      return bounds ? `${stage.id}:${q(bounds.x)}:${q(bounds.y)}:${q(bounds.width)}:${q(bounds.height)}` : `${stage.id}:empty`
    }).join('|')
  }, [nodeSizes, stageLayouts, stageSummaries])

  const zoomToFitRef = useRef(zoomToFit)
  zoomToFitRef.current = zoomToFit

  useEffect(() => {
    if (viewportPinned || expandedKey) return
    zoomToFitRef.current()
  }, [expandedKey, flowInstances, viewportKey, viewportPinned])

  /**
   * A person taking hold of the canvas pins it.
   *
   * onMoveStart was supposed to tell us this — its event argument is documented
   * as null for React Flow's own moves — but in practice it fired with an event
   * during the library's initial fitView, so the camera was pinned before the
   * first node had arrived and every later fit was skipped. The graph then ran
   * off the right of the screen and no amount of new work would bring it back.
   *
   * Wheel and pointer-down on the PANE are unambiguous: nothing but a person
   * produces them, and the pane excludes the cards, so clicking a card to read
   * it does not count as taking over the camera.
   */
  useEffect(() => {
    const cleanups = stageSummaries.flatMap((stage) => {
      const container = stageCanvasRefs.current[stage.id]
      if (!container) return []
      const pane = container.querySelector('.react-flow__pane')
      if (!pane) return []
      const pin = () => setViewportPinned(true)
      const pinIfPane = (event: Event) => { if (event.target === pane) pin() }
      pane.addEventListener('wheel', pin, { passive: true })
      pane.addEventListener('pointerdown', pinIfPane)
      return [() => {
        pane.removeEventListener('wheel', pin)
        pane.removeEventListener('pointerdown', pinIfPane)
      }]
    })
    return () => { for (const cleanup of cleanups) cleanup() }
  }, [flowInstances, stageSummaries])

  /**
   * Keep the selected card clear of the drawer.
   *
   * The drawer covers the right-hand strip of the stage workspace, so selecting
   * a card that sits under it would hide the very thing being described. This
   * pans by the minimum needed, treating the drawer as part of the right margin.
   * It preserves the person's zoom unless the card is physically wider or taller
   * than the available area; only then does it zoom out enough to fit. A card
   * already fully visible causes no movement at all.
   */
  useEffect(() => {
    if (!expandedKey) return
    const stage = stageSummaries.find((candidate) => candidate.nodeKeys.includes(expandedKey))
    if (!stage) return
    const instance = flowInstances[stage.id]
    const position = stageLayouts[stage.id]?.[expandedKey]
    const size = nodeSizes[expandedKey]
    const container = stageCanvasRefs.current[stage.id]
    if (!instance || !position || !size || !container) return

    const viewport = instance.getViewport()
    const { width, height } = container.getBoundingClientRect()
    const drawerWidth = container.querySelector<HTMLElement>('.node-drawer')
      ?.getBoundingClientRect().width ?? DRAWER_WIDTH
    const margin = 24
    const next = getVisibleNodeViewport(position, size, viewport, { width, height }, {
      top: margin,
      right: margin + drawerWidth,
      bottom: margin,
      left: margin,
    })

    if (
      Math.abs(next.x - viewport.x) < 1 &&
      Math.abs(next.y - viewport.y) < 1 &&
      Math.abs(next.zoom - viewport.zoom) < 0.001
    ) return
    moveCamera(instance, container, next)
  }, [expandedKey, flowInstances, nodeSizes, stageLayouts, stageSummaries])

  /**
   * Replay the run from its first event, at the pace it actually happened.
   *
   * The events are already in the log — this re-folds them rather than asking
   * the server for anything, so a replay works on a finished run and cannot
   * disturb a live one. Gaps are taken from the real occurred_at timestamps and
   * then compressed to fit a watchable span: a run that took nine minutes is
   * unwatchable at true speed, but a fixed tick would flatten the rhythm that
   * makes the graph readable — the pause where the agent was thinking is the
   * part worth seeing.
   */
  const replay = useCallback(() => {
    const recorded = [...state.event_log].sort((left, right) => left.sequence - right.sequence)
    if (recorded.length < 2 || replayingRef.current) return

    replayingRef.current = true
    setReplaying(true)
    setExpandedKey(null)
    setInstructionError(null)
    layoutRef.current = {}
    setMeasuredSizes({})
    setState(createInitialRunState(initialKey))

    const first = Date.parse(recorded[0].occurred_at)
    const span = Math.max(1, Date.parse(recorded[recorded.length - 1].occurred_at) - first)
    const scale = Math.min(1, REPLAY_TARGET_MS / span)

    let index = 0
    const step = () => {
      if (!replayingRef.current) return
      const event = recorded[index]
      if (!event) {
        replayingRef.current = false
        setReplaying(false)
        return
      }
      setState((current) => applyEvent(current, event))
      index += 1
      const next = recorded[index]
      if (!next) {
        replayTimerRef.current = window.setTimeout(step, 0)
        return
      }
      const gap = (Date.parse(next.occurred_at) - Date.parse(event.occurred_at)) * scale
      replayTimerRef.current = window.setTimeout(
        step,
        motionDuration(Math.min(REPLAY_MAX_GAP_MS, Math.max(REPLAY_MIN_GAP_MS, gap))),
      )
    }
    step()
  }, [initialKey, state.event_log])

  useEffect(() => () => {
    replayingRef.current = false
    if (replayTimerRef.current) window.clearTimeout(replayTimerRef.current)
  }, [])

  const reset = useCallback(async () => {
    replayingRef.current = false
    if (replayTimerRef.current) window.clearTimeout(replayTimerRef.current)
    setReplaying(false)
    abortRef.current?.abort()
    await readPromiseRef.current
    sourceRef.current = createSource(requestedRunKey)
    layoutRef.current = {}
    setState(createInitialRunState(initialKey))
    setExpandedKey(null)
    setMeasuredSizes({})
    setSuggestions({})
    setSourceError(null)
    setInstructionError(null)
    setViewportPinned(false)
    setSourceGeneration((generation) => generation + 1)
  }, [initialKey, requestedRunKey])

  const latestEvents = [...state.event_log].reverse().slice(0, 7)
  const latestReplan = getLatestReplan(state.event_log)
  const latestRecalculation = getLatestRecalculation(state.event_log)
  const request = getRunRequest(state.run)
  const runSavings = getRunSavings(state.nodes)
  const activeAgent = currentAgentName(state.nodes, visiblyActiveKey, state.event_log)
  const clientMetadata = clientProjectMetadata(state.event_log, state.run.plan_summary ?? state.run.name)

  return (
    <main className="donald">
      <header className="header">
        <ClientArea metadata={clientMetadata} activeAgent={activeAgent} currentTask={request} />
        <div className="run-status-pill" aria-label={`Run status: ${replaying ? 'Replaying' : runStatusLabel(state)}`}>
          <i className="live-dot" />
          {replaying ? 'REPLAY' : runStatusLabel(state)}
        </div>
        <div className="run-metadata" aria-label="Run metadata">
          <code>{state.run.key}</code>
          <small>{state.event_log.length} events · revision {state.run.graph_revision}</small>
        </div>
        {runSavings && (
          <div className="run-saving" title={runSavings.basis}>
            <span>Saved so far</span>
            <strong>{runSavings.humanTime}</strong>
            <em>{runSavings.money}</em>
          </div>
        )}
        <RunControls
          canReplay={state.event_log.length >= 2}
          onFit={() => { setViewportPinned(false); zoomToFit() }}
          onReplay={() => replaying ? void reset() : replay()}
          replaying={replaying}
        />
      </header>

      <DonaldNarration
        stages={stageSummaries}
      />

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
        {selectedNodeData && <NodeDrawer data={selectedNodeData} onClose={() => setExpandedKey(null)} />}
        <div className="operational-stage-stack">
          {stageGraphs.map(({ stage, nodes, edges, height, transitions }, index) => {
            const expanded = expandedStageIds.has(stage.id)
            return (
              <div className="operational-stage-group" key={stage.id}>
                {index === 1 && (
                  <div className="stage-line-divider" aria-label="Signal or trigger boundary">
                    <span>Signal / Trigger</span>
                  </div>
                )}
                <OperationalStageAccordion
                  expanded={expanded}
                  onToggle={() => toggleStage(stage.id)}
                  stage={stage}
                  transitions={transitions}
                >
                  {nodes.length === 0 && <p className="stage-empty-state">No active actions</p>}
                  {expanded && nodes.length > 0 && (
                    <div
                      className="stage-flow"
                      ref={(element) => { stageCanvasRefs.current[stage.id] = element }}
                      style={{ height }}
                    >
                      <ReactFlow
                        edges={edges}
                        edgeTypes={edgeTypes}
                        fitView
                        fitViewOptions={{ padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM }}
                        minZoom={MIN_FIT_ZOOM}
                        nodeTypes={nodeTypes}
                        nodes={nodes}
                        nodesConnectable={false}
                        nodesDraggable={false}
                        onInit={(instance) => {
                          setFlowInstances((current) => ({ ...current, [stage.id]: instance }))
                        }}
                        onPaneClick={() => setExpandedKey(null)}
                        onlyRenderVisibleElements={false}
                        panOnDrag
                        style={{ width: '100%', height: '100%' }}
                        zoomOnDoubleClick={false}
                      >
                        <Background color="#6990b3" gap={42} variant={BackgroundVariant.Lines} />
                      </ReactFlow>
                    </div>
                  )}
                </OperationalStageAccordion>
              </div>
            )
          })}
        </div>
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
        <div className="event-stream-brand" aria-label="Donald">
          <img src="/donald-logo-official.png" alt="" aria-hidden="true" width={52} height={18} />
        </div>
      </footer>
    </main>
  )
}
