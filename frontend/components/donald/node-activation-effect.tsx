'use client'

import { useEffect, useId, useRef } from 'react'

type NodeActivationEffectProps = {
  active: boolean
  effectKey: number
  onComplete?: () => void
}

export function NodeActivationEffect({
  active,
  effectKey,
  onComplete,
}: NodeActivationEffectProps) {
  const filterId = useId().replace(/:/g, '')
  const completedKey = useRef<number | null>(null)

  useEffect(() => {
    if (!active || completedKey.current === effectKey) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      completedKey.current = effectKey
      onComplete?.()
    }
  }, [active, effectKey, onComplete])

  if (!active) return null

  const complete = () => {
    if (completedKey.current === effectKey) return
    completedKey.current = effectKey
    onComplete?.()
  }

  return (
    <div
      key={effectKey}
      className="node-activation-effect"
      aria-hidden="true"
      onAnimationEnd={complete}
    >
      <svg className="node-activation-filter" focusable="false">
        <filter id={filterId}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0 0 0 22 -9"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      <div className="node-activation-goo" style={{ filter: `url(#${filterId})` }}>
        <span className="node-activation-seed" />
        <span className="node-activation-fill" />
      </div>
    </div>
  )
}
