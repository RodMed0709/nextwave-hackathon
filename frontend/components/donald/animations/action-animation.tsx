'use client'

import type { ActionPresentation } from '@/lib/donald/action-presentation'
import {
  getActionAnimationSpec,
  type ActionAnimationState,
} from '@/components/donald/animations/action-animation-registry'

type ActionAnimationProps = {
  presentation: ActionPresentation
  state: ActionAnimationState
}

function ActionIcon({ presentation, iconUrl }: { presentation: ActionPresentation; iconUrl: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="action-task-icon"
      height={34}
      onError={(event) => { event.currentTarget.hidden = true }}
      src={iconUrl}
      title={presentation.label}
      width={34}
    />
  )
}

function ActionMotion() {
  return (
    <>
      <span className="motion-flow-line motion-flow-line-one" />
      <span className="motion-flow-node motion-flow-node-one" />
      <span className="motion-flow-line motion-flow-line-two" />
      <span className="motion-flow-node motion-flow-node-two" />
      <span className="motion-flow-end" />
    </>
  )
}

export function ActionAnimation({ presentation, state }: ActionAnimationProps) {
  const spec = getActionAnimationSpec(presentation.animationKind)
  const classes = [
    'action-scene',
    spec.className,
    `action-scene-${state}`,
  ].join(' ')

  return (
    <div
      aria-label={`${presentation.label} action ${state}`}
      className={classes}
      data-action={presentation.id}
      data-animation-kind={spec.kind}
    >
      <div className="action-icon-slot">
        <ActionIcon presentation={presentation} iconUrl={spec.iconUrl} />
      </div>
      <div className="action-motion" aria-hidden="true">
        <ActionMotion />
      </div>
    </div>
  )
}
