import type { DonaldAnimationKind } from '@/lib/donald/action-presentation'

export type ActionAnimationState = 'waiting' | 'running' | 'done' | 'blocked' | 'failed'

export type ActionAnimationSpec = {
  kind: DonaldAnimationKind
  className: string
  iconUrl: string
}

const SVG_REPO_BASE = 'https://www.svgrepo.com/show'

const icons = {
  email: `${SVG_REPO_BASE}/392447/document-email-file-mail-message-communication.svg`,
  search: `${SVG_REPO_BASE}/142893/data-search.svg`,
  extract: `${SVG_REPO_BASE}/218163/extract.svg`,
  diff: `${SVG_REPO_BASE}/347737/file-diff.svg`,
  monitor: `${SVG_REPO_BASE}/529728/monitor.svg`,
  anomaly: `${SVG_REPO_BASE}/486526/anomaly-found.svg`,
  evidence: `${SVG_REPO_BASE}/6415/evidence.svg`,
  impact: `${SVG_REPO_BASE}/449103/impact.svg`,
  predict: `${SVG_REPO_BASE}/8352792/prediction.svg`,
  route: `${SVG_REPO_BASE}/8882115/route-planner.svg`,
  decision: `${SVG_REPO_BASE}/340133/decision-tree.svg`,
  send: `${SVG_REPO_BASE}/389782/paper-plane-send.svg`,
  money: `${SVG_REPO_BASE}/9382/money.svg`,
} as const

function spec(kind: DonaldAnimationKind, className: string, iconUrl: string): ActionAnimationSpec {
  return { kind, className, iconUrl }
}

export const ACTION_ANIMATION_REGISTRY: Record<DonaldAnimationKind, ActionAnimationSpec> = {
  default: spec('default', 'action-animation-default', icons.monitor),
  ingest: spec('ingest', 'action-animation-ingest', icons.email),
  identify: spec('identify', 'action-animation-identify', icons.search),
  extract: spec('extract', 'action-animation-extract', icons.extract),
  reconcile: spec('reconcile', 'action-animation-reconcile', icons.diff),
  monitor: spec('monitor', 'action-animation-monitor', icons.monitor),
  detect: spec('detect', 'action-animation-detect', icons.anomaly),
  explain: spec('explain', 'action-animation-explain', icons.evidence),
  impact: spec('impact', 'action-animation-impact', icons.impact),
  predict: spec('predict', 'action-animation-predict', icons.predict),
  plan: spec('plan', 'action-animation-plan', icons.route),
  decide: spec('decide', 'action-animation-decide', icons.decision),
  act: spec('act', 'action-animation-act', icons.send),
  email: spec('email', 'action-animation-email', icons.email),
  payment: spec('payment', 'action-animation-act', icons.money),
}


export function getActionAnimationSpec(kind: DonaldAnimationKind): ActionAnimationSpec {
  return ACTION_ANIMATION_REGISTRY[kind] ?? ACTION_ANIMATION_REGISTRY.default
}
