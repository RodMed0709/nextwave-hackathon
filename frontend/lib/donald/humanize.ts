import { donaldActionIdForNode, isEmailNode, type DonaldActionId } from './action-presentation'

/**
 * Card titles a person can read from across the room.
 *
 * The agent names its steps for itself — "Generate and rank response options"
 * is a fine machine label and a terrible headline. Anyone who did not write
 * the prompt should still follow the run, so verbose titles collapse to a
 * short human phrase for the action, and the original stays as the tooltip.
 */
const SHORT_TITLES: Record<DonaldActionId, string> = {
  ingest: 'Reading what arrived',
  identify: 'Identifying the players',
  extract: 'Pulling the key data',
  reconcile: 'Cross-checking records',
  monitor: 'Keeping watch',
  detect: 'Spotting the problem',
  explain: 'Finding the root cause',
  impact: 'Sizing the impact',
  predict: 'Forecasting the risk',
  plan: 'Agent thinking · options',
  decide: 'Your call',
  act: 'Making it happen',
}

/** Longest title that still reads as a headline rather than a sentence. */
const MAX_HEADLINE_LENGTH = 28

export type HumanTitle = {
  title: string
  /** The agent's own wording, when the headline replaced it; null when the title is already short. */
  original: string | null
}

export function humanizeStepTitle(input: {
  nodeKey: string
  label: string
  nodeType?: string | null
  toolName?: string | null
  headline?: string | null
}): HumanTitle {
  const raw = input.headline?.trim() || input.label.trim()
  if (raw.length <= MAX_HEADLINE_LENGTH) return { title: raw, original: null }
  if (isEmailNode({ nodeKey: input.nodeKey, label: input.label, toolName: input.toolName })) {
    return { title: 'Sending the email', original: raw }
  }
  const actionId = donaldActionIdForNode(input)
  if (!actionId) return { title: raw, original: null }
  return { title: SHORT_TITLES[actionId], original: raw }
}
