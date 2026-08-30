'use client'

import { Maximize2, Minus, Plus, type LucideIcon } from 'lucide-react'

type RunControlsProps = {
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

type ControlItem = {
  id: string
  label: string
  icon: LucideIcon
  title?: string
  onClick: () => void
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

export function RunControls({ onFit, onZoomIn, onZoomOut }: RunControlsProps) {
  const items: ControlItem[] = [
    { id: 'zoom-out', label: 'Zoom out', icon: Minus, onClick: onZoomOut },
    { id: 'zoom-in', label: 'Zoom in', icon: Plus, onClick: onZoomIn },
    { id: 'fit', label: 'Fit', icon: Maximize2, title: 'Fit the whole graph and follow it again', onClick: onFit },
  ]

  return (
    <nav aria-label="Run controls" className="run-controls-notch">
      <NotchLeftWing />
      <NotchRightWing />
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={item.onClick}
            title={item.title ?? item.label}
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
