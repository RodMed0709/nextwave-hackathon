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
  ArrowRight,
  Check,
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
  getFocusedNodeViewport,
  getLayoutBounds,
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
  getVisiblyActiveNodeKeys,
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
import { PromptBar } from '@/components/donald/prompt-bar'
import { pickSteerTargetKey } from '@/lib/donald/steer-target'
import { ClientArea } from '@/components/donald/client-area'
import { DonaldNarration } from '@/components/donald/donald-narration'
import { ImpactReceipt } from '@/components/donald/impact-receipt'
import { OperationalStage, stageDomId } from '@/components/donald/operational-stage'
import { ActionAnimation } from '@/components/donald/animations/action-animation'
import type { ActionAnimationState } from '@/components/donald/animations/action-animation-registry'
import {
  actionPresentationForNode,
  decisionOptionPresentation,
  type ActionPresentation,
} from '@/lib/donald/action-presentation'
import {
  clientProjectMetadata,
  operationalStageForNode,
  summarizeOperationalStages,
  type OperationalStageId,
  type OperationalStageSummary,
} from '@/lib/donald/operational-stages'
import { getStageImpactReceipt } from '@/lib/donald/impact-receipt'
import { getNextTaskSummary } from '@/lib/donald/next-task'
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
// How coarsely the graph's extent is measured before the camera reacts to it.
// One card width: smaller than a new column, larger than any text reflow.
const VIEWPORT_QUANTUM = 380
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

function isRecordedRunKey(runKey: string | null): boolean {
  return runKey === null || RECORDED_RUNS.has(runKey)
}

function createSource(runKey: string | null): DonaldEventSource {
  if (!API_BASE_URL || isRecordedRunKey(runKey)) return recordedSource({ recording: runKey })
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

function currentAgentNames(nodes: Record<string, RunNode>, activeNodeKeys: readonly string[], events: readonly DonaldEvent[]): Set<string> {
  const active = new Set(activeNodeKeys.flatMap((key) => nodes[key]?.agent_label ?? []))
  if (active.size > 0) return active
  const fallback = latestRunAgent(events) ?? declaredAgent(events)
  return new Set(fallback ? [fallback] : [])
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
  siblings,
  disabled,
  onChoose,
}: {
  option: InterventionOption
  siblings: InterventionOption[]
  disabled: boolean
  onChoose: (option: InterventionOption) => void
}) {
  const presentation = decisionOptionPresentation(option, siblings)
  return (
    <button
      className={`decision-option ${option.rank === 1 ? 'recommended' : ''}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChoose(option)
      }}
      title={presentation.tooltip}
      type="button"
    >
      <strong className="option-price">{presentation.price}</strong>
      <span className="option-arrow" aria-hidden="true">→</span>
      <span className="option-consequence">{presentation.consequence}</span>
      {option.rank === 1 && <em>Recommended</em>}
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
  const pending = data.interventions.find((record) =>
    record.origin === 'operator' && record.status !== 'resolved',
  ) ?? null
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
          <div className="section-label"><AlertTriangle size={13} /> Choose a response</div>
          <div className="decision-options">
            {options.map((option) => (
              <OptionButton
                disabled={busy}
                key={option.id}
                onChoose={(selected) => void data.onInstruction(selected.label, { optionId: selected.id })}
                option={option}
                siblings={options}
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

      {!data.intervention && data.interventions.map((record) => <InstructionTrail key={record.id} record={record} />)}
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
  const pendingIntervention = data.interventions.find((record) =>
    record.origin === 'operator' && record.status !== 'resolved',
  ) ?? null
  const title = node.output_summary?.headline ?? node.label
  const classes = [
    'flow-card',
    `action-${data.actionPresentation.id}`,
    statusClass(data.displayStatus),
    data.selected ? 'selected' : '',
    data.visiblyActive ? 'visibly-active' : '',
    data.intervention ? 'decision-open' : '',
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
      {data.intervention && <InstructionBox data={data} />}
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
      {!data.intervention && (
        <span className="expand-hint">
          {data.selected ? 'Showing details' : data.steerable ? 'Click to inspect or steer' : 'Click to inspect'}
        </span>
      )}
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
  // Normal selection stays fixed; only a live decision grows at its graph anchor.
  const style = {
    '--node-enter-delay': `${data.appearance.delayMs}ms`,
    width: `${data.intervention ? 620 : COLLAPSED_SIZE.width}px`,
  } as CSSProperties
  return (
    <div
      className={`flow-node-shell born ${data.appearance.discovered ? 'discovered' : ''}`}
      ref={shellRef}
      style={style}
    >
      <FlowCard data={data} />
      {data.selected && (
        <div className="card-details-embed">
          <ExpandedDetails data={data} />
        </div>
      )}
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

export function RunViewer({ requestedRunKey }: { requestedRunKey: string | null }) {
  const initialKey = requestedRunKey ?? 'latest'
  const [state, setState] = useState(() => createInitialRunState(initialKey))
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [instructionError, setInstructionError] = useState<string | null>(null)
  const [submittingNodeKey, setSubmittingNodeKey] = useState<string | null>(null)
  const [flowInstances, setFlowInstances] = useState<Partial<Record<OperationalStageId, ReactFlowInstance>>>({})
  // Set the moment the person pans or zooms by hand. From then on the canvas is
  // theirs: an agent adding a node must not move a camera someone is holding.
  const [viewportPinned, setViewportPinned] = useState(false)
  const [measuredSizes, setMeasuredSizes] = useState<Record<string, NodeSize>>({})
  const [suggestions, setSuggestions] = useState<Record<string, PromptSuggestion[]>>({})
  const [decisionRecalculationKey, setDecisionRecalculationKey] = useState<string | null>(null)
  // A view-side pause: the reader loop stops pulling, the source keeps
  // buffering, and resume drains from the cursor. The agent itself never stops
  // — instructions queued while paused reach it exactly as they would live.
  const [paused, setPaused] = useState(false)
  const sourceRef = useRef<DonaldEventSource | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const readPromiseRef = useRef<Promise<ReadOutcome> | null>(null)
  const layoutRef = useRef<Partial<Record<OperationalStageId, Record<string, LayoutPosition>>>>({})
  const stageCanvasRefs = useRef<Partial<Record<OperationalStageId, HTMLElement | null>>>({})
  const decisionRecalculationTimerRef = useRef<number | null>(null)
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
    if (paused) return
    if (state.open_intervention) return
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
  }, [paused, readNext, state.open_intervention])

  useEffect(() => () => abortRef.current?.abort(), [])

  const togglePause = useCallback(() => {
    // Abort the in-flight read so a recorded run's timestamp wait does not
    // land one more event after the person asked the screen to hold still.
    if (!paused) abortRef.current?.abort()
    setPaused(!paused)
  }, [paused])

  // Measured sizes let the one in-place decision reserve room without allowing
  // ordinary detail selection to rearrange the graph.
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
  const visiblyActiveKeys = useMemo(
    () => getVisiblyActiveNodeKeys(state.nodes, state.event_log),
    [state.event_log, state.nodes],
  )
  const visiblyActiveKeySet = useMemo(() => new Set(visiblyActiveKeys), [visiblyActiveKeys])
  const stageSummaries = useMemo(() => summarizeOperationalStages(state.nodes, state.edges), [state.edges, state.nodes])
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
    const latestActiveKey = visiblyActiveKeys[0]
    if (latestActiveKey && state.nodes[latestActiveKey]) {
      return operationalStageForNode(state.nodes[latestActiveKey], { nodes: state.nodes, edges: state.edges })
    }
    return stageSummaries.find((stage) => stage.state === 'needs-human')?.id ??
      stageSummaries.find((stage) => stage.id === 'below' && stage.state === 'in-progress')?.id ??
      stageSummaries.find((stage) => stage.state === 'in-progress')?.id ??
      null
  }, [stageSummaries, state.edges, state.nodes, visiblyActiveKeys])

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
    if (options.optionId) {
      if (decisionRecalculationTimerRef.current) window.clearTimeout(decisionRecalculationTimerRef.current)
      setDecisionRecalculationKey(`${node.node_key}:${options.optionId}:${Date.now()}`)
      decisionRecalculationTimerRef.current = window.setTimeout(() => {
        setDecisionRecalculationKey(null)
        decisionRecalculationTimerRef.current = null
      }, 2_200)
    }
    try {
      // The write path follows the same recorded/live split as createSource: a
      // recorded run does not exist on the real API, so its POST goes to the
      // local mock (postOperatorInstruction with a null base URL).
      const recorded = !API_BASE_URL || isRecordedRunKey(requestedRunKey)
      const event = await postOperatorInstruction(recorded ? null : API_BASE_URL, state.run.key, {
        nodeKey: node.node_key,
        instruction,
        optionId: options.optionId,
        type: options.kind ?? 'steer',
        currentSequence: state.last_sequence,
      })
      setState((current) => applyEvent(current, event))
      if (recorded && options.optionId) {
        // A recording already contains the gate's resolution and the path the
        // choice opens; play it forward immediately so the choice registers and
        // the UI advances without waiting out the recorded timestamps.
        const source = sourceRef.current
        while (source) {
          const result = await source.next({ immediate: true })
          if (result.done) break
          setState((current) => applyEvent(current, result.value))
          if (result.value.event_type === 'intervention_resolved') break
        }
      }
    } catch (error: unknown) {
      setInstructionError(error instanceof Error ? error.message : 'Instruction could not be queued')
    } finally {
      setSubmittingNodeKey(null)
    }
  }, [requestedRunKey, state.last_sequence, state.run.key])

  useEffect(() => () => {
    if (decisionRecalculationTimerRef.current) window.clearTimeout(decisionRecalculationTimerRef.current)
  }, [])

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
          visiblyActive: visiblyActiveKeySet.has(node.node_key),
          appearance: graphPresentation.nodes[node.node_key] ?? { delayMs: 0, discovered: false, batch: 0 },
          liveStatus: visiblyActiveKeySet.has(node.node_key) ? getLatestNodeStatus(node, state.event_log) : null,
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
        visiblyActiveKeySet.has(target.node_key) ? 'ACTIVE' :
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
      receipt: getStageImpactReceipt(stage.id, Object.values(stageNodes)),
    }
  }), [expandedKey, graphPresentation.edges, graphPresentation.nodes, nodeSizes, stageLayouts, stageSummaries, state.edges, state.event_log, state.interventions, state.nodes, state.open_intervention, state.run.graph_revision, submitInstruction, submittingNodeKey, suggestions, updateMeasurement, visiblyActiveKeySet])

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
    const expandedStages = stageSummaries.filter((stage) => stage.totalActions > 0)
    const orderedStages = [
      ...expandedStages.filter((stage) => stage.id === activeStageId),
      ...expandedStages.filter((stage) => stage.id !== activeStageId),
    ]
    for (const stage of orderedStages) zoomStageToFit(stage.id)
    if (activeStageId) {
      document.getElementById(stageDomId(activeStageId))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeStageId, stageSummaries, zoomStageToFit])

  const changeZoom = useCallback((direction: 'in' | 'out') => {
    setViewportPinned(true)
    for (const instance of Object.values(flowInstances)) {
      if (!instance) continue
      if (direction === 'in') void instance.zoomIn({ duration: 0 })
      else void instance.zoomOut({ duration: 0 })
    }
  }, [flowInstances])

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

  /** Center selected cards inside their own stage canvas. Normal inspection now
   * happens in the graph, so the camera moves to the card instead of opening a
   * separate drawer. Human intervention may still render the drawer below.
   */
  useEffect(() => {
    if (!expandedKey) return
    const stage = stageSummaries.find((candidate) => candidate.nodeKeys.includes(expandedKey))
    if (!stage) return
    document.getElementById(stageDomId(stage.id))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const instance = flowInstances[stage.id]
    const position = stageLayouts[stage.id]?.[expandedKey]
    const size = nodeSizes[expandedKey]
    const container = stageCanvasRefs.current[stage.id]
    if (!instance || !position || !size || !container) return

    const viewport = instance.getViewport()
    const { width, height } = container.getBoundingClientRect()
    const next = getFocusedNodeViewport(position, size, { width, height })
    if (
      Math.abs(next.x - viewport.x) < 1 &&
      Math.abs(next.y - viewport.y) < 1 &&
      Math.abs(next.zoom - viewport.zoom) < 0.001
    ) return
    moveCamera(instance, container, next)
  }, [expandedKey, flowInstances, nodeSizes, stageLayouts, stageSummaries, state.open_intervention])

  const latestReplan = getLatestReplan(state.event_log)
  const latestRecalculation = getLatestRecalculation(state.event_log)
  const request = getRunRequest(state.run)
  const runSavings = getRunSavings(state.nodes)
  const activeAgents = currentAgentNames(state.nodes, visiblyActiveKeys, state.event_log)
  const clientMetadata = clientProjectMetadata(state.event_log, state.run.plan_summary ?? state.run.name)
  const nextTask = getNextTaskSummary(state)
  const steerTargetKey = pickSteerTargetKey(state, nextTask.nodeKeys, visiblyActiveKeys)
  const adjust = useCallback(() => {
    if (!steerTargetKey) return
    setExpandedKey(steerTargetKey)
    document.getElementById(stageDomId(operationalStageForNode(state.nodes[steerTargetKey])))
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.nodes, steerTargetKey])

  const submitFromBar = useCallback(async (instruction: string) => {
    if (!steerTargetKey) return
    const node = state.nodes[steerTargetKey]
    if (!node) return
    // Open the card the instruction lands on, so the person sees it queue.
    setExpandedKey(node.node_key)
    await submitInstruction(node, instruction)
  }, [state.nodes, steerTargetKey, submitInstruction])

  return (
    <main className="donald">
      <header className="header">
        <ClientArea metadata={clientMetadata} currentTask={request} />
        <section className="operational-intelligence" aria-label="Operational intelligence">
          <div className="client-meta-field connected-agents-field">
            <span>Connected Nauta</span>
            <div className="agent-chip-list">
              {clientMetadata.agents.length === 0 && <strong>Unavailable</strong>}
              {clientMetadata.agents.map((agent) => (
                <span
                  className={activeAgents.has(agent.label) ? 'agent-chip active' : 'agent-chip'}
                  key={`${agent.label}-${agent.role ?? 'agent'}`}
                  title={agent.role ?? agent.label}
                >
                  {agent.label}{agent.role ? ` / ${agent.role}` : ''}
                </span>
              ))}
            </div>
          </div>
          <div className="kpi-grid" aria-label="Run KPIs">
            <div className="kpi-card">
              <span>Status</span>
              <strong>{runStatusLabel(state)}</strong>
            </div>
            <div className="kpi-card" title={runSavings?.basis}>
              <span>Time Saved</span>
              <strong>{runSavings?.humanTime ?? '0m'}</strong>
            </div>
            <div className="kpi-card" title={runSavings?.basis}>
              <span>Value Protected</span>
              <strong>{runSavings?.money ?? '$0'}</strong>
            </div>
            <div className="kpi-card">
              <span>Events</span>
              <strong>{state.event_log.length}</strong>
            </div>
          </div>
          <div className={`next-task-card state-${nextTask.state}`} aria-label="Next task in line">
            <span>{nextTask.label}</span>
            <strong>{nextTask.titles[0]}</strong>
            {nextTask.titles[1] && <small>{nextTask.titles[1]}</small>}
            <ArrowRight aria-hidden="true" size={16} />
          </div>
          <div className="run-metadata" aria-label="Run metadata">
            <code>{state.run.key}</code>
            <small>· revision {state.run.graph_revision}</small>
          </div>
        </section>
        <div className="run-status-pill" aria-label={`Run status: ${runStatusLabel(state)}`}>
          <i className="live-dot" />
          {runStatusLabel(state)}
        </div>
        <RunControls
          canPause
          onAdjust={adjust}
          onFit={() => { setViewportPinned(false); zoomToFit() }}
          onPause={togglePause}
          onZoomIn={() => changeZoom('in')}
          onZoomOut={() => changeZoom('out')}
          paused={paused}
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
        {decisionRecalculationKey && (
          <div className="replan-overlay decision" key={decisionRecalculationKey}>
            <div className="recalculating">Recalculating…</div>
          </div>
        )}
        {sourceError && <div className="source-error"><AlertTriangle size={14} />{sourceError}</div>}
        {selectedNodeData?.intervention && <NodeDrawer data={selectedNodeData} onClose={() => setExpandedKey(null)} />}
        <div className="operational-stage-stack">
          {stageGraphs.map(({ stage, nodes, edges, height, receipt }) => (
            <div className="operational-stage-group" key={stage.id}>
                <OperationalStage stage={stage}>
                  {nodes.length === 0 && <p className="stage-empty-state">No active actions</p>}
                  {nodes.length > 0 && (
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
                        panOnScroll={false}
                        preventScrolling={false}
                        zoomOnScroll={false}
                        style={{ width: '100%', height: '100%' }}
                        zoomOnDoubleClick={false}
                      >
                        <Background color="#6990b3" gap={42} variant={BackgroundVariant.Lines} />
                      </ReactFlow>
                    </div>
                  )}
                  {stage.id !== 'unclassified' && <ImpactReceipt receipt={receipt} />}
                </OperationalStage>
            </div>
          ))}
        </div>
      </section>

      <PromptBar
        error={instructionError}
        onSubmit={submitFromBar}
        paused={paused}
        submitting={submittingNodeKey !== null}
        targetLabel={steerTargetKey ? state.nodes[steerTargetKey]?.label ?? null : null}
      />
    </main>
  )
}
