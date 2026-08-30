import type { DonaldAnimationKind } from '@/lib/donald/action-presentation'

export type ActionAnimationState = 'waiting' | 'running' | 'done' | 'blocked' | 'failed'

export type ActionAnimationSpec = {
  kind: DonaldAnimationKind
  className: string
}

export const ACTION_ANIMATION_REGISTRY: Record<DonaldAnimationKind, ActionAnimationSpec> = {
  default: { kind: 'default', className: 'action-animation-default' },
  ingest: { kind: 'ingest', className: 'action-animation-ingest' },
  identify: { kind: 'identify', className: 'action-animation-default' },
  extract: { kind: 'extract', className: 'action-animation-default' },
  reconcile: { kind: 'reconcile', className: 'action-animation-default' },
  monitor: { kind: 'monitor', className: 'action-animation-default' },
  detect: { kind: 'detect', className: 'action-animation-default' },
  explain: { kind: 'explain', className: 'action-animation-default' },
  impact: { kind: 'impact', className: 'action-animation-default' },
  predict: { kind: 'predict', className: 'action-animation-default' },
  plan: { kind: 'plan', className: 'action-animation-default' },
  decide: { kind: 'decide', className: 'action-animation-default' },
  act: { kind: 'act', className: 'action-animation-act' },
  email: { kind: 'email', className: 'action-animation-email' },
}

export function getActionAnimationSpec(kind: DonaldAnimationKind): ActionAnimationSpec {
  return ACTION_ANIMATION_REGISTRY[kind] ?? ACTION_ANIMATION_REGISTRY.default
}
