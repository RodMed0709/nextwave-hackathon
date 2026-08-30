'use client'

import { useCallback, useEffect, useState } from 'react'
import { Maximize2, Pause, Share2, type LucideIcon } from 'lucide-react'

type RunControlsProps = {
  onRefresh: () => void | Promise<void>
  onFit: () => void
}

type ControlItem = {
  id: string
  label: string
  icon: LucideIcon
  onClick: () => void | Promise<void>
}

function NotchLeftWing() {
  return (
    <svg
      aria-hidden="true"
      className="run-controls-wing left"
      fill="none"
      height="20"
      shapeRendering="geometricPrecision"
      viewBox="0 0 20 20"
      width="20"
    >
      <path d="M 0 0 C 11.046 0 20 8.954 20 20 H 21 V -1 H 0 Z" fill="currentColor" />
    </svg>
  )
}

function NotchRightWing() {
  return (
    <svg
      aria-hidden="true"
      className="run-controls-wing right"
      fill="none"
      height="20"
      shapeRendering="geometricPrecision"
      viewBox="0 0 20 20"
      width="20"
    >
      <path d="M 20 0 C 8.954 0 0 8.954 0 20 H -1 V -1 H 20 Z" fill="currentColor" />
    </svg>
  )
}

async function copyCurrentUrl() {
  const url = window.location.href
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = url
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function RunControls({ onRefresh, onFit }: RunControlsProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle')

  useEffect(() => {
    if (shareState === 'idle') return
    const timer = window.setTimeout(() => setShareState('idle'), 1400)
    return () => window.clearTimeout(timer)
  }, [shareState])

  const handleShare = useCallback(async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title || 'Donald run', url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    await copyCurrentUrl()
    setShareState('copied')
  }, [])

  const items: ControlItem[] = [
    { id: 'refresh', label: 'Pause', icon: Pause, onClick: onRefresh },
    { id: 'share', label: shareState === 'copied' ? 'Copied' : 'Share', icon: Share2, onClick: handleShare },
    { id: 'fit', label: 'Fit', icon: Maximize2, onClick: onFit },
  ]

  return (
    <nav aria-label="Run controls" className="run-controls-notch">
      <NotchLeftWing />
      <NotchRightWing />
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            aria-live={item.id === 'share' ? 'polite' : undefined}
            className={shareState === 'copied' && item.id === 'share' ? 'copied' : undefined}
            key={item.id}
            onClick={() => void item.onClick()}
            title={item.label}
            type="button"
          >
            <Icon size={14} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
