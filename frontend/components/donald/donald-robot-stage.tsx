'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CircleDollarSign,
  Clock3,
  FileText,
  Mail,
  Send,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useViewport, ViewportPortal } from '@xyflow/react'
import { deriveRobotMotion } from '@/lib/donald/motion'
import type { LayoutPosition, NodeSize } from '@/lib/donald/layout'
import type { DonaldEvent, RunState } from '@/lib/donald/types'

type DonaldRobotStageProps = {
  layout: Record<string, LayoutPosition>
  nodeSizes: Record<string, NodeSize>
  state: RunState
}

type RobotBubble = {
  Icon: LucideIcon
  label: string
}

const ACTIVE_VERBS: Record<string, string> = {
  Read: 'Reading',
  Find: 'Finding',
  Identify: 'Identifying',
  Extract: 'Extracting',
  Verify: 'Verifying',
  Check: 'Checking',
  Calculate: 'Calculating',
  Submit: 'Submitting',
  Send: 'Sending',
  Reconcile: 'Reconciling',
  Track: 'Tracking',
  Forecast: 'Forecasting',
  Decide: 'Deciding',
  Reschedule: 'Rescheduling',
}

function activeNodeLabel(label: string): string {
  const [verb, ...rest] = label.split(' ')
  const activeVerb = ACTIVE_VERBS[verb]
  return activeVerb ? `${activeVerb} ${rest.join(' ')}` : 'Working'
}

function bubbleFor(
  event: DonaldEvent,
  motion: ReturnType<typeof deriveRobotMotion>,
  tone: ReturnType<typeof deriveRobotMotion>['cue']['tone'],
  nodeLabel: string,
  nodeStatus: string | undefined,
  waitingForUser: boolean,
): RobotBubble {
  if (motion.cue.metric) {
    return {
      Icon: CircleDollarSign,
      label: new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: motion.cue.metric.currency,
        maximumFractionDigits: 0,
      }).format(motion.cue.metric.value),
    }
  }

  if (tone === 'waiting') {
    if (waitingForUser) return { Icon: Clock3, label: 'Waiting for your response' }
    if (nodeStatus === 'blocked_on_missing_data') return { Icon: FileText, label: 'Waiting for invoice' }
    if (nodeStatus === 'blocked_on_provider_outage') return { Icon: Clock3, label: 'Waiting for Nauta agent' }
    return { Icon: Clock3, label: 'Waiting' }
  }
  if (tone === 'failure') return { Icon: TriangleAlert, label: 'Needs attention' }
  if (tone === 'success') return { Icon: Check, label: 'Done' }

  switch (motion.cue.activity) {
    case 'document.read': return { Icon: FileText, label: motion.cue.object?.label ?? 'Reading file' }
    case 'message.send': return { Icon: Send, label: 'Sending update' }
    case 'message.receive': return { Icon: Mail, label: 'Reading message' }
    case 'data.check': return { Icon: FileText, label: 'Checking data' }
    case 'calculate': return { Icon: CircleDollarSign, label: 'Calculating' }
    case 'submit': return { Icon: Send, label: 'Submitting' }
    case 'work.generic': break
  }

  if (event.event_type === 'artifact_added') return { Icon: FileText, label: 'File checked' }
  if (event.event_type === 'agent_message') return { Icon: Mail, label: 'Message received' }
  if (event.event_type.startsWith('operator_instruction_')) return { Icon: Send, label: 'Sending update' }
  return { Icon: Sparkles, label: activeNodeLabel(nodeLabel) }
}

export function DonaldRobotStage({ layout, nodeSizes, state }: DonaldRobotStageProps) {
  const { zoom } = useViewport()
  const previousNodeKey = useRef<string | null>(null)
  const [displayNodeKey, setDisplayNodeKey] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [fading, setFading] = useState(false)
  const [teleporting, setTeleporting] = useState(false)
  const latestEvent = state.event_log[state.event_log.length - 1] ?? null

  const motion = useMemo(() => latestEvent ? deriveRobotMotion({
    event: latestEvent,
    events: state.event_log,
    nodes: state.nodes,
    edges: state.edges,
    previousNodeKey: previousNodeKey.current,
  }) : null, [latestEvent, state.edges, state.event_log, state.nodes])

  const targetNodeKey = motion?.cue.targetNodeKey ?? null

  useEffect(() => {
    if (!targetNodeKey || !motion) return
    const changedNode = previousNodeKey.current !== null && previousNodeKey.current !== targetNodeKey
    previousNodeKey.current = targetNodeKey
    if (!changedNode) {
      setDisplayNodeKey(targetNodeKey)
      return
    }

    if (motion.transition.kind === 'fade') {
      setMoving(false)
      setTeleporting(true)
      setFading(true)
      const swapTimer = window.setTimeout(() => {
        setDisplayNodeKey(targetNodeKey)
        setFading(false)
      }, 160)
      const finishTimer = window.setTimeout(() => setTeleporting(false), 340)
      return () => {
        window.clearTimeout(swapTimer)
        window.clearTimeout(finishTimer)
      }
    }

    setDisplayNodeKey(targetNodeKey)
    setMoving(motion.transition.kind === 'travel')
    const timer = window.setTimeout(() => setMoving(false), 900)
    return () => window.clearTimeout(timer)
  }, [motion, targetNodeKey])

  if (!latestEvent || !motion || !displayNodeKey) return null
  const position = layout[displayNodeKey]
  const size = nodeSizes[displayNodeKey]
  if (!position || !size) return null

  const targetNode = state.nodes[displayNodeKey]
  const tone = state.open_intervention?.node_key === displayNodeKey || targetNode?.status.startsWith('blocked_on_')
    ? 'waiting'
    : motion.cue.tone
  const nodeLabel = targetNode?.label ?? displayNodeKey
  // React Flow scales portal content with the graph. Keep Donald legible when
  // Fit zooms a long run out, while his graph-space anchor still follows the
  // real node. This changes only the actor, never Maykel's camera or cards.
  const robotScale = Math.min(3.6, Math.max(1, .85 / zoom))
  const bubble = bubbleFor(
    latestEvent,
    motion,
    tone,
    nodeLabel,
    targetNode?.status,
    state.open_intervention?.node_key === displayNodeKey,
  )
  const BubbleIcon = bubble.Icon

  return (
    <ViewportPortal>
      <div
        className={`donald-robot-stage tone-${tone} transition-${motion.transition.kind} ${moving ? 'is-moving' : ''} ${fading ? 'is-fading' : ''} ${teleporting ? 'is-teleporting' : ''}`}
        style={{
          transform: `translate3d(${position.x + size.width / 2 - 91}px, ${position.y - 205}px, 0) scale(${robotScale})`,
        }}
        aria-label={`Donald is ${bubble.label.toLowerCase()} at ${nodeLabel}`}
        aria-live="polite"
      >
        <div className="donald-robot-bubble">
          <BubbleIcon size={24} strokeWidth={2.2} />
          <span>{bubble.label}</span>
        </div>
        <div className="donald-robot-glow" />
        <img src="/donald-pet/donald-default.webp" alt="" className="donald-robot-image" />
        <div className="donald-robot-shadow" />
      </div>
    </ViewportPortal>
  )
}
