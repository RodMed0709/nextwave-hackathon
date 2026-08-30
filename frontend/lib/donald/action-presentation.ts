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
export type DonaldAnimationKind = DonaldActionId | 'default'

export type ActionPresentation = {
  id: DonaldActionId
  label: string
  petAsset: string
  animationKind: DonaldAnimationKind
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

export function actionPresentationForNode(input: {
  nodeKey: string
  label: string
  nodeType?: string | null
}): ActionPresentation {
  return ACTION_PRESENTATIONS[donaldActionIdForNode(input) ?? 'ingest']
}

export function donaldActionIdForNode(input: {
  nodeKey: string
  label: string
  nodeType?: string | null
}): DonaldActionId | null {
  const haystack = [input.nodeKey, input.label, input.nodeType ?? ''].filter(Boolean).join(' ')
  for (const actionId of DONALD_ACTION_IDS) {
    if (ACTION_KEYWORDS[actionId].some((keyword) => hasActionWord(haystack, keyword))) {
      return actionId
    }
  }
  return null
}
