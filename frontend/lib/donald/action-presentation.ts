import type { InterventionOption } from './types'

export const DONALD_ACTION_IDS = [
  'ingest',
  'identify',
  'extract',
  'reconcile',
  'monitor',
  'detect',
  'explain',
  'impact',
  'predict',
  'plan',
  'decide',
  'act',
] as const

export type DonaldActionId = typeof DONALD_ACTION_IDS[number]
export type DonaldAnimationKind = DonaldActionId | 'default' | 'email'

export type ActionPresentation = {
  id: DonaldActionId
  label: string
  petAsset: string
  animationKind: DonaldAnimationKind
}

export type DecisionOptionPresentation = {
  price: string
  consequence: string
  tooltip: string
}

export const DEFAULT_DONALD_PET_ASSET = '/donald_favicon.png'

export const ACTION_PRESENTATIONS: Record<DonaldActionId, ActionPresentation> = {
  ingest: {
    id: 'ingest',
    label: 'Ingest',
    petAsset: '/pets/ingest-pet.png',
    animationKind: 'ingest',
  },
  identify: {
    id: 'identify',
    label: 'Identify',
    petAsset: '/pets/identify-pet.png',
    animationKind: 'identify',
  },
  extract: {
    id: 'extract',
    label: 'Extract',
    petAsset: '/pets/extract-pet.png',
    animationKind: 'extract',
  },
  reconcile: {
    id: 'reconcile',
    label: 'Reconcile',
    petAsset: '/pets/reconcile-pet.png',
    animationKind: 'reconcile',
  },
  monitor: {
    id: 'monitor',
    label: 'Monitor',
    petAsset: '/pets/monitor-pet.png',
    animationKind: 'monitor',
  },
  detect: {
    id: 'detect',
    label: 'Detect',
    petAsset: '/pets/detect-pet.png',
    animationKind: 'detect',
  },
  explain: {
    id: 'explain',
    label: 'Explain',
    petAsset: '/pets/explain-pet.png',
    animationKind: 'explain',
  },
  impact: {
    id: 'impact',
    label: 'Impact',
    petAsset: '/pets/impact-pet.png',
    animationKind: 'impact',
  },
  predict: {
    id: 'predict',
    label: 'Predict',
    petAsset: '/pets/predict-pet.png',
    animationKind: 'predict',
  },
  plan: {
    id: 'plan',
    label: 'Plan',
    petAsset: '/pets/plan-pet.png',
    animationKind: 'plan',
  },
  decide: {
    id: 'decide',
    label: 'Decide',
    petAsset: '/pets/decide-pet.png',
    animationKind: 'decide',
  },
  act: {
    id: 'act',
    label: 'Act',
    petAsset: '/pets/act-pet.png',
    animationKind: 'act',
  },
}

const ACTION_KEYWORDS: Record<DonaldActionId, string[]> = {
  ingest: ['ingest', 'receive', 'read', 'load', 'collect'],
  identify: ['identify', 'resolve', 'match-entity', 'entity'],
  extract: ['extract', 'parse', 'pull'],
  reconcile: ['reconcile', 'compare', 'match-record'],
  monitor: ['monitor', 'watch', 'track', 'clock'],
  detect: ['detect', 'spot', 'confirm', 'exception', 'anomaly', 'conflict'],
  explain: ['explain', 'root-cause', 'root cause', 'cause'],
  impact: ['impact', 'exposure', 'quantify', 'calculate', 'consequence'],
  predict: ['predict', 'forecast', 'risk', 'overrun'],
  plan: ['plan', 'response', 'rank', 'option'],
  decide: ['decide', 'decision', 'approve', 'gate'],
  act: ['act', 'execute', 'book', 'send', 'apply'],
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_/]+/g, '-')
}

function hasActionWord(candidate: string, word: string): boolean {
  const normalized = normalize(candidate)
  const normalizedWord = normalize(word)
  return normalized === normalizedWord ||
    normalized.startsWith(`${normalizedWord}-`) ||
    normalized.includes(`-${normalizedWord}-`) ||
    normalized.endsWith(`-${normalizedWord}`)
}

/**
 * Email steps keep the `act` action id — stages, receipts and labels treat
 * sending a brief as acting — but get their own scene so the card can show a
 * letter leaving instead of the generic execute pulse.
 */
const EMAIL_KEYWORDS = ['email', 'mail', 'brief', 'notify', 'inform']

function isEmailNode(input: { nodeKey: string; label: string; toolName?: string | null }): boolean {
  const haystack = [input.nodeKey, input.label, input.toolName ?? ''].filter(Boolean).join(' ')
  return EMAIL_KEYWORDS.some((keyword) => hasActionWord(haystack, keyword))
}

export function actionPresentationForNode(input: {
  nodeKey: string
  label: string
  nodeType?: string | null
  toolName?: string | null
  headline?: string | null
  detail?: string | null
}): ActionPresentation {
  if (isEmailNode(input)) {
    return { ...ACTION_PRESENTATIONS.act, label: 'Email', animationKind: 'email' }
  }
  return ACTION_PRESENTATIONS[donaldActionIdForNode(input) ?? 'ingest']
}

export function donaldActionIdForNode(input: {
  nodeKey: string
  label: string
  nodeType?: string | null
  toolName?: string | null
  headline?: string | null
  detail?: string | null
}): DonaldActionId | null {
  for (const actionId of DONALD_ACTION_IDS) {
    if (hasActionWord(input.nodeKey, actionId)) return actionId
  }
  const haystack = [
    input.nodeKey,
    input.label,
    input.nodeType ?? '',
    input.toolName ?? '',
    input.headline ?? '',
    input.detail ?? '',
  ].filter(Boolean).join(' ')
  for (const actionId of DONALD_ACTION_IDS) {
    if (ACTION_KEYWORDS[actionId].some((keyword) => hasActionWord(haystack, keyword))) {
      return actionId
    }
  }
  return null
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const ETA_DATE_PATTERN = /\bETA\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/

/** Day-of-year style index for an "ETA <Month> <day>" mention, or null. */
function etaDayIndex(label: string): number | null {
  const match = label.match(ETA_DATE_PATTERN)
  if (!match) return null
  const month = MONTH_INDEX[match[1].slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  const day = Number(match[2])
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  // Any non-leap year works: only differences between indices are used.
  return Date.UTC(2001, month, day) / 86_400_000
}

/**
 * A person deciding under pressure compares options against each other, not
 * against a calendar: "Oct 1 vs Oct 3 vs Oct 7" makes the reader do the
 * subtraction, "same day vs +2 days vs +6 days" does it for them. The baseline
 * is the earliest ETA among the gate's own options, so the deltas are the
 * operational trade-off the choice is actually about. Labels whose dates cannot
 * be parsed keep their original text.
 */
function etaDelta(label: string, baseline: number | null): string | null {
  if (baseline === null) return null
  let day = etaDayIndex(label)
  if (day === null) return null
  if (day < baseline) day += 365 // year wrap: a Jan ETA against a Dec baseline
  const delta = day - baseline
  if (delta === 0) return 'ETA same day'
  return `ETA +${delta} ${delta === 1 ? 'day' : 'days'}`
}

export function decisionOptionPresentation(
  option: InterventionOption,
  siblings: readonly InterventionOption[] = [],
): DecisionOptionPresentation {
  const price = option.maximum_cost_usd === null
    ? option.label.match(/\+?\$[\d,]+(?:\.\d{1,2})?/)?.[0] ?? 'Cost TBD'
    : option.maximum_cost_usd === 0
      ? '$0'
      : `+$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(option.maximum_cost_usd)}`
  const consequenceSource = option.label.split(/\s[-–—]\s/).slice(1).join(' - ') || option.label
  const dayIndices = [option, ...siblings]
    .map((candidate) => etaDayIndex(candidate.label))
    .filter((value): value is number => value !== null)
  const baseline = dayIndices.length > 1 ? Math.min(...dayIndices) : null
  const delta = etaDelta(consequenceSource, baseline)
  const consequence = (delta ? consequenceSource.replace(ETA_DATE_PATTERN, delta) : consequenceSource)
    .replace(/,?\s*\+?\$[\d,]+(?:\.\d{1,2})?(?:\s*USD)?/gi, '')
    .replace(/^[,\s]+|[,\s]+$/g, '')

  return {
    price,
    consequence: consequence || 'Review operational impact',
    tooltip: option.rationale ?? option.label,
  }
}
