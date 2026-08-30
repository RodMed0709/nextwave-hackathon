'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_DONALD_PET_ASSET,
  type ActionPresentation,
} from '@/lib/donald/action-presentation'
import {
  getActionAnimationSpec,
  type ActionAnimationState,
} from '@/components/donald/animations/action-animation-registry'

type ActionAnimationProps = {
  presentation: ActionPresentation
  state: ActionAnimationState
}

function PetImage({ presentation }: { presentation: ActionPresentation }) {
  const [asset, setAsset] = useState(presentation.petAsset)

  useEffect(() => {
    setAsset(presentation.petAsset)
  }, [presentation.petAsset])

  return (
    <img
      alt={`${presentation.label} pet`}
      className="action-pet-image"
      height={58}
      onError={() => setAsset(DEFAULT_DONALD_PET_ASSET)}
      src={asset}
      width={58}
    />
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
      <div className="action-pet">
        <PetImage presentation={presentation} />
      </div>
      <div className="action-motion" aria-hidden="true">
        <span className="motion-orbit motion-orbit-one" />
        <span className="motion-orbit motion-orbit-two" />
        <span className="motion-pulse" />
        <span className="motion-signal motion-signal-one" />
        <span className="motion-signal motion-signal-two" />
        <span className="motion-signal motion-signal-three" />
        {spec.kind === 'email' && (
          <span className="motion-envelope">
            <svg viewBox="0 0 24 18" width="24" height="18">
              <rect x="1" y="1" width="22" height="16" rx="2" fill="var(--paper)" stroke="var(--navy)" strokeWidth="1.4" />
              <path d="M 1.5 2.5 L 12 10 L 22.5 2.5" fill="none" stroke="var(--navy)" strokeWidth="1.4" />
            </svg>
          </span>
        )}
      </div>
    </div>
  )
}
