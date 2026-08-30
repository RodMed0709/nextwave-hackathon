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
  Zap,
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
  getCombinedLayoutBounds,
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
import { ExecutiveStrip } from '@/components/donald/executive-strip'
import { getExecutivePhases } from '@/lib/donald/executive-phases'
import { PromptBar } from '@/components/donald/prompt-bar'
import { pickSteerTargetKey } from '@/lib/donald/steer-target'
import { AgentRail } from '@/components/donald/agent-rail'
import { MapPopup, type MapPopupData } from '@/components/donald/map-popup'
import { AmbientStrip } from '@/components/donald/ambient-strip'
import { ClientArea } from '@/components/donald/client-area'
import { DonaldNarration } from '@/components/donald/donald-narration'
import { ImpactReceipt } from '@/components/donald/impact-receipt'
import { OperationalStage, stageDomId } from '@/components/donald/operational-stage'
import { ActionAnimation } from '@/components/donald/animations/action-animation'
import type { ActionAnimationState } from '@/components/donald/animations/action-animation-registry'
import {
  actionPresentationForNode,
  decisionOptionPresentation,
  donaldActionIdForNode,
  isEmailNode,
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
import { humanizeStepTitle } from '@/lib/donald/humanize'
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

/** What the live Scenario Director (/api/interpret) says a bar prompt means. */
type InterpretedFlow = {
  detectLabel?: string
  detectHeadline?: string
  assessHeadline?: string
  assessFinding?: string
  actLabel?: string
  emailSubject?: string
  emailBody?: string
  origin?: string
  destination?: string
  mapNote?: string
}
type InterpretedTask = {
  label?: string
  doneHeadline?: string
  finding?: string
  email?: boolean
  emailSubject?: string
  emailBody?: string
  document?: { name?: string; body?: string }
}
type InterpretResult = {
  intent?: 'show_map' | 'show_document' | 'new_flow' | 'task'
  summary?: string
  document?: { name?: string; body?: string }
  flow?: InterpretedFlow
  task?: InterpretedTask
}

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
  onReadEmail: () => void
  onViewMap: () => void
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

/** The step's finding as at most three short bullets — the card's answer. */
function findingBullets(detail: string | null | undefined): string[] {
  if (!detail) return []
  return detail
    .split(/(?<=[.;])\s+/)
    .map((sentence) => sentence.trim().replace(/[.;]$/, ''))
    .filter((sentence) => sentence.length > 0)
    .slice(0, 3)
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

/**
 * The email, presented as an email.
 *
 * The artifact block renders raw text in a blockquote, which reads like a log.
 * A message someone actually sent deserves an envelope view: subject on top,
 * From/To/Date as metadata, body as prose. Opens as a popup so it works from
 * the collapsed card without fighting the graph's layout.
 */
function EmailPopup({ node, onClose }: { node: RunNode; onClose: () => void }) {
  const artifact = getLatestArtifact(node.artifacts)
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!artifact?.text_content) return null
  const lines = artifact.text_content.split('\n')
  const headers: Record<string, string> = {}
  let bodyStart = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(To|From|Date|Subject):\s*(.+)$/i)
    if (match) {
      headers[match[1].toLowerCase()] = match[2].trim()
      bodyStart = index + 1
      continue
    }
    if (Object.keys(headers).length > 0) {
      bodyStart = lines[index].trim() === '' ? index + 1 : index
      break
    }
    break
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  return (
    <div className="email-popup-backdrop" onClick={onClose} role="presentation">
      <article aria-label={artifact.name} className="email-popup" onClick={(event) => event.stopPropagation()}>
        <header>
          <div className="email-popup-title">
            <Send aria-hidden="true" size={14} />
            <strong>{headers.subject ?? artifact.name}</strong>
          </div>
          <button aria-label="Close email" onClick={onClose} type="button"><X size={16} /></button>
        </header>
        <dl className="email-popup-meta">
          {headers.from && <div><dt>From</dt><dd>{headers.from}</dd></div>}
          {headers.to && <div><dt>To</dt><dd>{headers.to}</dd></div>}
          {headers.date && <div><dt>Date</dt><dd>{headers.date}</dd></div>}
        </dl>
        <div className="email-popup-body">{body || artifact.text_content}</div>
      </article>
    </div>
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
          <p className="intervention-prompt">{data.intervention.prompt}</p>
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

      {(!data.intervention && (data.steerable || data.interventions.length > 0)) && <InstructionBox data={data} />}
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
  // A decision is a choice, not a reading assignment: when the gate is open
  // the drawer shows the question and the options — nothing else. The full
  // step detail is still one card-click away after deciding.
  const decisionOnly = Boolean(data.intervention)
  return (
    <aside aria-label={`Details for ${node.label}`} className={decisionOnly ? 'node-drawer decision-only' : 'node-drawer'}>
      <header className="drawer-header">
        <div>
          <span className="owner"><UserRound size={12} /> {node.agent_label ?? 'Donald'}</span>
          <span className={`status ${statusClass(data.displayStatus)}`}>
            <StatusMark status={data.displayStatus} /> {data.displayStatus}
          </span>
        </div>
        <h2>{decisionOnly ? 'Your call' : humanizeStepTitle({
          nodeKey: node.node_key,
          label: node.label,
          nodeType: node.node_type,
          toolName: node.tool_name,
        }).title}</h2>
        {!decisionOnly && <code>{node.node_key}</code>}
        <button aria-label="Close details" className="drawer-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </header>
      <div className="drawer-body">
        {decisionOnly
          ? (
            <>
              {data.intervention?.prompt && <p className="decision-question">{data.intervention.prompt}</p>}
              <InstructionBox data={data} />
            </>
          )
          : <ExpandedDetails data={data} />}
      </div>
    </aside>
  )
}

function FlowCard({ data }: { data: FlowNodeData }) {
  const node = data.runtimeNode
  const latestArtifact = getLatestArtifact(node.artifacts)
  const primaryMetric = getPrimaryMetric(node.output_summary?.metrics ?? {})
  const pendingIntervention = data.interventions.find((record) =>
    record.origin === 'operator' && record.status !== 'resolved',
  ) ?? null
  // The title is the humanized TASK NAME; the answer (headline + finding)
  // renders below once the step is done. Titling the card with the finding
  // hid the one thing an observer wants: what question is this step even
  // answering, and what did it find.
  const humanTitle = humanizeStepTitle({
    nodeKey: node.node_key,
    label: node.label,
    nodeType: node.node_type,
    toolName: node.tool_name,
  })
  const isEmail = isEmailNode({ nodeKey: node.node_key, label: node.label, toolName: node.tool_name })
  const emailArtifact = isEmail ? getLatestArtifact(node.artifacts) : null
  const cardTitle = (data.displayStatus === 'DONE' && node.output_summary?.headline) || humanTitle.title
  const classes = [
    'flow-card',
    `action-${data.actionPresentation.id}`,
    statusClass(data.displayStatus),
    data.selected ? 'selected' : '',
    data.visiblyActive ? 'visibly-active' : '',
    data.intervention ? 'decision-open' : '',
    pendingIntervention ? 'steered' : '',
    data.appearance.steeredBorn ? 'steered-born' : '',
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
      <span className="action-chip">{data.actionPresentation.label}</span>
      {/* The title EVOLVES: while running it names the task, once done it
          becomes the finding itself — titles are data, never fixed copy. */}
      <h2
        className={cardTitle.length > 30 ? 'long' : undefined}
        title={humanTitle.original ?? node.label}
      >{cardTitle}</h2>
      <ActionAnimation
        presentation={data.actionPresentation}
        state={animationState(data.displayStatus)}
      />
      {data.intervention && <InstructionBox data={data} />}
      {primaryMetric && <div className="primary-metric"><span>{primaryMetric.label}</span><strong>{primaryMetric.value}</strong></div>}
      {data.liveStatus && <p className="live-status"><i />{data.liveStatus.text}</p>}
      {/* Subtasks live only in the expanded details now — the card face is
          for the ANSWER. The headline moved into the title itself, so the
          answer block carries just the finding's bullets. */}
      {data.displayStatus === 'DONE' && findingBullets(node.output_summary?.detail).length > 0 && (
        <div className="card-answer">
          <ul>
            {findingBullets(node.output_summary?.detail).map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
        </div>
      )}
      {pendingIntervention && (
        <p className="card-instruction"><Hand size={11} /> {pendingIntervention.type === 'stop' ? 'Stop' : 'Steer'} sent — {pendingIntervention.status === 'queued' ? 'waiting for the agent' : 'agent has it'}</p>
      )}
      {emailArtifact && (
        <button
          className="read-email"
          onClick={(event) => { event.stopPropagation(); data.onReadEmail() }}
          type="button"
        >
          <FileText aria-hidden="true" size={12} /> Read the email
        </button>
      )}
      {/\bvessel|voyage|transship|route|ship\b/i.test(node.label) && (
        <button
          className="read-email view-map"
          onClick={(event) => { event.stopPropagation(); data.onViewMap() }}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={12} /> Route map
        </button>
      )}
      {latestArtifact && !isEmail && (
        <button
          className="read-email view-doc"
          onClick={(event) => { event.stopPropagation(); data.onReadEmail() }}
          title={latestArtifact.name}
          type="button"
        >
          <FileText aria-hidden="true" size={12} /> Open the document
        </button>
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
  const [emailPopupKey, setEmailPopupKey] = useState<string | null>(null)
  const [mapPopup, setMapPopup] = useState<MapPopupData | null>(null)
  // A document generated on the fly ("open the invoice we received") — shown
  // in the same viewer without needing a card to hang off.
  const [docPopup, setDocPopup] = useState<{ name: string; body: string } | null>(null)
  // Route data for synthesised cases, keyed by their node-key prefix, so the
  // map button on those cards shows THEIR voyage rather than the main one.
  const syntheticRoutesRef = useRef<Record<string, MapPopupData>>({})
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
    return () => {
      cancelled = true
      // Abort atomically with cancellation: aborting from togglePause let the
      // still-live loop open one more read that landed an event mid-pause.
      abortRef.current?.abort()
    }
  }, [paused, readNext, state.open_intervention])

  useEffect(() => () => abortRef.current?.abort(), [])

  const togglePause = useCallback(() => {
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

  const synthesizeTaskRef = useRef<(instruction: string, parentKey: string) => void>(() => {})
  const drainingRef = useRef(false)

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
      const gateOpenHere = state.open_intervention?.node_key === node.node_key
      if (recorded && (options.optionId || gateOpenHere) && !drainingRef.current) {
        // A recording already contains the gate's resolution and the path the
        // choice opens; play it forward immediately so the choice registers and
        // the UI advances without waiting out the recorded timestamps. Custom
        // instructions and stops on the open gate drain too - otherwise the
        // reader loop waits on an intervention nothing will ever resolve.
        drainingRef.current = true
        try {
          const source = sourceRef.current
          while (source) {
            const result = await source.next({ immediate: true })
            if (result.done) break
            setState((current) => applyEvent(current, result.value))
            if (result.value.event_type === 'intervention_resolved') break
          }
        } finally {
          drainingRef.current = false
        }
      } else if (recorded && !options.optionId && !gateOpenHere) {
        // A plain steer on a card in a recording has no agent to answer it;
        // grow a visible task so the button is never dead.
        synthesizeTaskRef.current(instruction, node.node_key)
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
            toolName: node.tool_name,
            headline: node.output_summary?.headline ?? null,
            detail: node.output_summary?.detail ?? null,
          }),
          selected,
          visiblyActive: visiblyActiveKeySet.has(node.node_key),
          appearance: graphPresentation.nodes[node.node_key] ?? { delayMs: 0, discovered: false, steeredBorn: false, batch: 0 },
          liveStatus: visiblyActiveKeySet.has(node.node_key) ? getLatestNodeStatus(node, state.event_log) : null,
          intervention,
          interventions: getNodeInterventions(state.interventions, node.node_key),
          steerable: canIntervene(node),
          instructionError: selected ? instructionError : null,
          submitting: submittingNodeKey === node.node_key,
          suggestions: suggestions[`${node.node_key}:${state.run.graph_revision}`] ?? [],
          onToggle: () => {
            // Second click on the open card closes it AND releases the camera,
            // so the auto-fit zooms back out to the whole stage. Without the
            // unpin, a hand-adjusted viewport stayed zoomed into the card and
            // there was no way back to the full picture.
            if (expandedKey === node.node_key) {
              setViewportPinned(false)
              setExpandedKey(null)
            } else {
              setExpandedKey(node.node_key)
            }
          },
          onReadEmail: () => setEmailPopupKey(node.node_key),
          onViewMap: () => {
            const prefix = Object.keys(syntheticRoutesRef.current).find((candidate) => node.node_key.startsWith(candidate))
            setMapPopup(prefix
              ? syntheticRoutesRef.current[prefix]
              : {
                title: 'OP-4471 — live route',
                origin: 'Xiamen, CN',
                destination: 'San Juan, PR',
                note: 'Re-booked onto MSC ILONA FE2440, direct — new ETA Oct 3, the committed Oct 10 delivery holds.',
              })
          },
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
      bounds,
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
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setViewportPinned(false)
      setExpandedKey(null)
    }
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

  const bothPrimaryStagesActive = useMemo(() => {
    const activeStages = new Set(visiblyActiveKeys.flatMap((nodeKey) => {
      const node = state.nodes[nodeKey]
      if (!node || node.removed) return []
      return [operationalStageForNode(node, { nodes: state.nodes, edges: state.edges })]
    }))
    return activeStages.has('above') && activeStages.has('below')
  }, [state.edges, state.nodes, visiblyActiveKeys])

  const zoomBothPrimaryStagesToFit = useCallback(() => {
    const primaryStageIds: OperationalStageId[] = ['above', 'below']
    const combined = getCombinedLayoutBounds(
      primaryStageIds.map((stageId) => {
        const positions = stageLayouts[stageId] ?? {}
        return getLayoutBounds(positions, nodeSizes)
      }),
      48,
    )
    if (!combined) return false

    let moved = false
    for (const stageId of primaryStageIds) {
      const instance = flowInstances[stageId]
      const container = stageCanvasRefs.current[stageId]
      if (!instance || !container) continue
      const { width, height } = container.getBoundingClientRect()
      if (width === 0 || height === 0) continue
      moveCamera(instance, container, getFitViewport(combined, { width, height }))
      moved = true
    }
    document.getElementById(stageDomId('above'))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return moved
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
  const zoomBothPrimaryStagesToFitRef = useRef(zoomBothPrimaryStagesToFit)
  zoomBothPrimaryStagesToFitRef.current = zoomBothPrimaryStagesToFit

  useEffect(() => {
    if (viewportPinned || expandedKey) return
    if (bothPrimaryStagesActive && zoomBothPrimaryStagesToFitRef.current()) return
    zoomToFitRef.current()
  }, [bothPrimaryStagesActive, expandedKey, flowInstances, viewportKey, viewportPinned])

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

  /** Center selected cards inside their own stage canvas. Normal inspection and
   * human gates both happen in the graph, so no external drawer competes with
   * the card.
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
  // Live content for the executive strip: the watch ticker's nodes, the step
  // running right now, and the last thing that went out.
  const ambientNodes = useMemo(() => {
    const above = stageSummaries.find((stage) => stage.id === 'above')
    return above ? above.nodeKeys.flatMap((nodeKey) => state.nodes[nodeKey] ? [state.nodes[nodeKey]] : []) : []
  }, [stageSummaries, state.nodes])
  const solvingNow = useMemo(() => {
    const activeKey = visiblyActiveKeys.find((key) => state.nodes[key] && !state.nodes[key].removed)
    if (activeKey) {
      const node = state.nodes[activeKey]
      return humanizeStepTitle({ nodeKey: node.node_key, label: node.label, nodeType: node.node_type, toolName: node.tool_name }).title
    }
    return nextTask.titles[0] ?? null
  }, [nextTask.titles, state.nodes, visiblyActiveKeys])
  const actingNow = useMemo(() => {
    let latest: RunNode | null = null
    for (const node of Object.values(state.nodes)) {
      if (node.removed || node.status !== 'succeeded') continue
      if (!isEmailNode({ nodeKey: node.node_key, label: node.label, toolName: node.tool_name }) &&
        donaldActionIdForNode({ nodeKey: node.node_key, label: node.label, nodeType: node.node_type, toolName: node.tool_name }) !== 'act') continue
      if (!latest || (node.finished_at ?? '') > (latest.finished_at ?? '')) latest = node
    }
    return latest ? latest.output_summary?.headline ?? latest.label : null
  }, [state.nodes])

  const triggerHeadline = useMemo(() => {
    for (const node of Object.values(state.nodes)) {
      if (node.removed) continue
      const actionId = donaldActionIdForNode({
        nodeKey: node.node_key,
        label: node.label,
        nodeType: node.node_type,
        toolName: node.tool_name,
      })
      if (actionId === 'detect' && node.output_summary?.headline) return node.output_summary.headline
    }
    return null
  }, [state.nodes])
  const adjust = useCallback(() => {
    if (!steerTargetKey) return
    setExpandedKey(steerTargetKey)
    document.getElementById(stageDomId(operationalStageForNode(state.nodes[steerTargetKey])))
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.nodes, steerTargetKey])

  /** Apply a locally synthesised event, sequenced just past whatever the run
   * has seen — so it is never dropped as stale and never swallows a recorded
   * event's integer sequence. */
  const emitLocal = useCallback((event: Omit<DonaldEvent, 'sequence'>) => {
    setState((current) => applyEvent(current, { ...event, sequence: current.last_sequence + 0.001 } as DonaldEvent))
  }, [])

  const syntheticTaskCountRef = useRef(0)

  /**
   * A recorded run has no agent behind it, so a bar instruction must still DO
   * something visible: it grows the graph. The instruction becomes a new
   * discovered card hanging off the steer target — violet, FROM YOUR
   * INSTRUCTION — that runs and completes locally. Live runs skip this: the
   * real agent picks the instruction up and grows the graph itself.
   */
  const synthesizeSteeredTask = useCallback((instruction: string, parentKey: string, content?: InterpretResult) => {
    syntheticTaskCountRef.current += 1
    const key = `steer_task_${syntheticTaskCountRef.current}`
    const task = content?.task
    const emailish = task?.email ?? /\b(mail|email|send|notify|inform|write|client|customer)\b/i.test(instruction)
    const label = task?.label ?? (instruction.length > 46 ? `${instruction.slice(0, 43)}…` : instruction)
    const agent = emailish ? 'Lex' : task?.document ? 'Theo' : 'Rex'
    let part = 0
    const mk = (event_type: string, node_key: string | null, payload: Record<string, unknown>): Omit<DonaldEvent, 'sequence'> => {
      part += 1
      return {
        event_type,
        occurred_at: new Date().toISOString(),
        agent_label: agent,
        node_key,
        idempotency_key: `synthetic:${key}:${part}`,
        payload,
      }
    }
    emitLocal(mk('node_added', key, { label, planned: false }))
    emitLocal(mk('edge_added', null, {
      edge_key: `${parentKey}-to-${key}`,
      source_node_key: parentKey,
      target_node_key: key,
      planned: false,
    }))
    emitLocal(mk('node_status_changed', key, { status: 'in_progress', started_at: new Date().toISOString() }))
    window.setTimeout(() => {
      emitLocal(mk('node_updated', key, { message: 'Working on your instruction…', progress_percent: 55 }))
    }, 2_800)
    window.setTimeout(() => {
      if (emailish) {
        emitLocal(mk('artifact_added', key, {
          artifact_type: 'text',
          name: `Email — ${label}`,
          text_content:
            'To: the recipient you asked for\n' +
            'From: lex@ops.nauta.ai\n' +
            `Date: ${new Date().toUTCString()}\n` +
            `Subject: ${task?.emailSubject ?? label}\n\n` +
            (task?.emailBody ??
              'Hi,\n\n' +
              `As requested: ${instruction}\n\n` +
              'Context on OP-4471: the shipment was re-booked onto MSC ILONA FE2440, ' +
              'sailing direct to San Juan at no extra cost, with the new ETA on Oct 3. ' +
              'The committed Oct 10 delivery holds.\n\n' +
              'Lex — Expedite Communication, Nauta'),
        }))
      }
      if (task?.document?.body) {
        emitLocal(mk('artifact_added', key, {
          artifact_type: 'text',
          name: task.document.name ?? 'Document extract',
          text_content: task.document.body,
        }))
      }
      emitLocal(mk('node_status_changed', key, {
        status: 'succeeded',
        headline: task?.doneHeadline ?? (emailish ? 'Sent — as instructed' : 'Done — as instructed'),
        finding: task?.finding ?? content?.summary ?? `Completed from your instruction: ${instruction}`,
        manual_minutes: 10,
      }))
      // The deliverable pops on its own: an email or document you asked for
      // should not need a second click to be seen.
      if (emailish || task?.document?.body) setEmailPopupKey(key)
    }, 6_400)
  }, [emitLocal])

  /**
   * A NEW-EVENT instruction ("a vessel just deviated…") is not a steer on an
   * existing step — it is the watch catching something else. So it opens a
   * second flow INSIDE The Response: a Nina detect card born off the ambient
   * monitor, then Rex assessing, then Lex acting — all in parallel with
   * whatever the main case is doing, no reload, no second page.
   */
  const synthesizeSteeredCase = useCallback((instruction: string, content?: InterpretResult) => {
    syntheticTaskCountRef.current += 1
    const prefix = `live_case_${syntheticTaskCountRef.current}`
    const flow = content?.flow
    const short = instruction.length > 42 ? `${instruction.slice(0, 39)}…` : instruction
    const routeMatch = instruction.match(/from\s+([A-Za-zÀ-ÿ ,]{3,24}?)\s+to\s+([A-Za-zÀ-ÿ ,]{3,24})(?:[.,;]|$)/i)
    syntheticRoutesRef.current[prefix] = {
      title: 'New case — live route',
      origin: flow?.origin ?? routeMatch?.[1]?.trim() ?? 'Vung Tau, VN',
      destination: flow?.destination ?? routeMatch?.[2]?.trim() ?? 'Manzanillo, MX',
      note: flow?.mapNote ?? 'Unplanned transshipment on the voyage — ETA slips ~9 days. Donald is sizing the damage.',
    }
    let part = 0
    const mk = (event_type: string, node_key: string | null, agent: string, payload: Record<string, unknown>): Omit<DonaldEvent, 'sequence'> => {
      part += 1
      return {
        event_type,
        occurred_at: new Date().toISOString(),
        agent_label: agent,
        node_key,
        idempotency_key: `synthetic:${prefix}:${part}`,
        payload,
      }
    }
    const detectKey = `${prefix}_detect_vessel_event`
    const assessKey = `${prefix}_assess_impact`
    const actKey = `${prefix}_notify_email`
    emitLocal(mk('node_added', detectKey, 'Nina', { label: flow?.detectLabel ?? `Detect: ${short}`, planned: false }))
    emitLocal(mk('edge_added', null, 'Nina', {
      edge_key: `ambient_monitor-to-${detectKey}`,
      source_node_key: 'ambient_monitor',
      target_node_key: detectKey,
      planned: false,
    }))
    emitLocal(mk('node_status_changed', detectKey, 'Nina', { status: 'in_progress', started_at: new Date().toISOString() }))
    window.setTimeout(() => {
      emitLocal(mk('node_status_changed', detectKey, 'Nina', {
        status: 'succeeded',
        headline: flow?.detectHeadline ?? 'Caught it — new vessel event on the book',
        finding: content?.summary ?? instruction,
        manual_minutes: 8,
      }))
      emitLocal(mk('node_added', assessKey, 'Rex', { label: 'Assess the vessel deviation', planned: false }))
      emitLocal(mk('edge_added', null, 'Rex', {
        edge_key: `${detectKey}-to-${assessKey}`,
        source_node_key: detectKey,
        target_node_key: assessKey,
        planned: false,
      }))
      emitLocal(mk('node_status_changed', assessKey, 'Rex', { status: 'in_progress', started_at: new Date().toISOString() }))
    }, 2_600)
    window.setTimeout(() => {
      emitLocal(mk('node_updated', assessKey, 'Rex', { message: 'Re-computing the ETA and checking committed deliveries…', progress_percent: 60 }))
    }, 5_200)
    window.setTimeout(() => {
      emitLocal(mk('node_status_changed', assessKey, 'Rex', {
        status: 'succeeded',
        headline: flow?.assessHeadline ?? 'ETA slips ~9 days on the deviation',
        finding: flow?.assessFinding ?? 'Unplanned transshipment detected on the voyage. Committed deliveries checked against the new ETA; options priced and ready if a commitment is at risk.',
        manual_minutes: 18,
      }))
      emitLocal(mk('node_added', actKey, 'Lex', { label: flow?.actLabel ?? 'Notify the client by email', planned: false }))
      emitLocal(mk('edge_added', null, 'Lex', {
        edge_key: `${assessKey}-to-${actKey}`,
        source_node_key: assessKey,
        target_node_key: actKey,
        planned: false,
      }))
      emitLocal(mk('node_status_changed', actKey, 'Lex', { status: 'in_progress', started_at: new Date().toISOString() }))
    }, 8_200)
    window.setTimeout(() => {
      emitLocal(mk('artifact_added', actKey, 'Lex', {
        artifact_type: 'text',
        name: 'Email — vessel deviation update',
        text_content:
          'To: the client\n' +
          'From: lex@ops.nauta.ai\n' +
          `Date: ${new Date().toUTCString()}\n` +
          `Subject: ${flow?.emailSubject ?? 'Voyage update — unplanned transshipment, new ETA under review'}\n\n` +
          (flow?.emailBody ??
            'Hi,\n\n' +
            `Our watch just caught this on your voyage: ${instruction}\n\n` +
            'The vessel made an unplanned stop and the ETA slips about 9 days. We are ' +
            'already pricing alternatives and will bring you a decision only if a ' +
            'committed delivery is at risk.\n\n' +
            'Lex — Expedite Communication, Nauta'),
      }))
      emitLocal(mk('node_status_changed', actKey, 'Lex', {
        status: 'succeeded',
        headline: 'Client informed — options on standby',
        finding: 'The client has the deviation and the new ETA; alternatives stay priced in case the schedule degrades further.',
        manual_minutes: 12,
      }))
      setEmailPopupKey(actKey)
    }, 12_000)
  }, [emitLocal])

  synthesizeTaskRef.current = synthesizeSteeredTask

  const submitFromBar = useCallback(async (instruction: string) => {
    if (!steerTargetKey) return
    const node = state.nodes[steerTargetKey]
    if (!node) return
    // The visible buffer between asking and the agents taking it in.
    if (decisionRecalculationTimerRef.current) window.clearTimeout(decisionRecalculationTimerRef.current)
    setDecisionRecalculationKey(`steer:${node.node_key}:${Date.now()}`)
    decisionRecalculationTimerRef.current = window.setTimeout(() => {
      setDecisionRecalculationKey(null)
      decisionRecalculationTimerRef.current = null
    }, 2_200)

    // Ask the live Scenario Director what this prompt MEANS — the summary,
    // the copy in the agents' voice, and whether it deserves a parallel flow,
    // a single task, or just showing something. The heuristics below are only
    // the fallback for when the director is unreachable.
    let interpreted: InterpretResult | null = null
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 9_000)
      const response = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction }),
        signal: controller.signal,
      })
      window.clearTimeout(timer)
      if (response.ok) interpreted = await response.json() as InterpretResult
    } catch {
      // Fall through to the keyword heuristics.
    }

    if (interpreted?.intent === 'show_document' && interpreted.document?.body) {
      // "Open the invoice we received" is a question too: show the document,
      // freshly written by the director, queue nothing.
      setDocPopup({
        name: interpreted.document.name ?? 'Document',
        body: interpreted.document.body,
      })
      return
    }

    if (interpreted?.intent === 'show_map' || (!interpreted && /\b(show|see|open|view|where)\b.*\b(map|route|vessel|voyage)\b/i.test(instruction))) {
      // "Show me the map" is a question, not work: answer it, queue nothing.
      const prefixes = Object.keys(syntheticRoutesRef.current)
      const latest = prefixes[prefixes.length - 1]
      setMapPopup(latest ? syntheticRoutesRef.current[latest] : {
        title: 'OP-4471 — live route',
        origin: 'Xiamen, CN',
        destination: 'San Juan, PR',
        note: 'Re-booked onto MSC ILONA FE2440, direct — new ETA Oct 3, the committed Oct 10 delivery holds.',
      })
      return
    }

    await submitInstruction(node, instruction)
    const recorded = !API_BASE_URL || isRecordedRunKey(requestedRunKey)
    if (recorded) {
      const newCase = interpreted
        ? interpreted.intent === 'new_flow'
        : /\b(vessel|barco|ship|voyage|transship|deviat|desvi|divert|delay|just happened|acaba de|new (case|shipment|operation|booking)|apareci)\b/i.test(instruction)
      if (newCase) synthesizeSteeredCase(instruction, interpreted ?? undefined)
      else synthesizeSteeredTask(instruction, node.node_key, interpreted ?? undefined)
      // Release the camera: the whole point is SEEING the new card arrive,
      // and a focused card pins the viewport away from it.
      setExpandedKey(null)
      setViewportPinned(false)
    }
  }, [requestedRunKey, state.nodes, steerTargetKey, submitInstruction, synthesizeSteeredCase, synthesizeSteeredTask])

  return (
    <main className="donald">
      <header className="header">
        <ClientArea metadata={clientMetadata} currentTask={request} />
        <section className="operational-intelligence" aria-label="Operational intelligence">
          {/* Two numbers, not four: value protected already lives in the stage
              receipts below, and an event count means nothing to a client. */}
          <div className="kpi-grid" aria-label="Run KPIs">
            <div className="kpi-card">
              <span>Status</span>
              <strong>{runStatusLabel(state)}</strong>
            </div>
            <div className="kpi-card" title={runSavings?.basis}>
              <span>Manual Work Replaced</span>
              <strong>{runSavings?.humanTime ?? '0m'}</strong>
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
      </header>

      <ExecutiveStrip
        actingNow={actingNow}
        phases={getExecutivePhases(state.nodes)}
        solvingNow={solvingNow}
        watchContent={(
          <AmbientStrip
            nodes={ambientNodes}
          />
        )}
      />

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
        <div className="operational-stage-stack">
          {/* The Watch lives in the executive strip now; only the case lanes
              render as graph sections — one flow to read, less scrolling. */}
          {stageGraphs.filter(({ stage }) => stage.id !== 'above').map(({ stage, nodes, edges, height, receipt }) => (
            <div className="operational-stage-group" key={stage.id}>
                {/* The narrative hinge: without it the two lanes read as two
                    unrelated boxes. It names the SPECIFIC thing the watch
                    caught, so it never repeats the lane description. */}
                {stage.id === 'below' && stage.totalActions > 0 && (
                  <div className="lane-handoff" aria-label="How this case started">
                    <Zap aria-hidden="true" size={14} />
                    <span>{triggerHeadline
                      ? `The watch caught it: ${triggerHeadline}`
                      : 'The watch caught something — it opened this case'}</span>
                  </div>
                )}
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
                        onPaneClick={() => {
                          // Closing a card from the pane also releases the
                          // camera so the stage fits again; a bare pane click
                          // with nothing open keeps the person's own viewport.
                          if (expandedKey) setViewportPinned(false)
                          setExpandedKey(null)
                        }}
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
                  {stage.id === 'below' && <ImpactReceipt receipt={receipt} />}
                </OperationalStage>
            </div>
          ))}
        </div>
      </section>

      {emailPopupKey && state.nodes[emailPopupKey] && (
        <EmailPopup node={state.nodes[emailPopupKey]} onClose={() => setEmailPopupKey(null)} />
      )}

      {mapPopup && <MapPopup data={mapPopup} onClose={() => setMapPopup(null)} />}

      {docPopup && (
        <div className="email-popup-backdrop" onClick={() => setDocPopup(null)} role="presentation">
          <article aria-label={docPopup.name} className="email-popup" onClick={(event) => event.stopPropagation()}>
            <header>
              <div className="email-popup-title">
                <FileText aria-hidden="true" size={14} />
                <strong>{docPopup.name}</strong>
              </div>
              <button aria-label="Close document" onClick={() => setDocPopup(null)} type="button"><X size={16} /></button>
            </header>
            <div className="email-popup-body">{docPopup.body}</div>
          </article>
        </div>
      )}

      <AgentRail active={activeAgents} agents={clientMetadata.agents} />

      <div className="prompt-dock">
        <RunControls
          canPause
          onAdjust={adjust}
          onFit={() => { setViewportPinned(false); zoomToFit() }}
          onPause={togglePause}
          onZoomIn={() => changeZoom('in')}
          onZoomOut={() => changeZoom('out')}
          paused={paused}
        />
        <PromptBar
          error={instructionError}
          onSubmit={submitFromBar}
          paused={paused}
          submitting={submittingNodeKey !== null}
          targetLabel={steerTargetKey ? state.nodes[steerTargetKey]?.label ?? null : null}
        />
      </div>
    </main>
  )
}
