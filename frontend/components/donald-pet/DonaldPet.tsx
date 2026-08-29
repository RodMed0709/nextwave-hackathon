'use client'

import Image from 'next/image'
import { getCapabilityPetAsset } from './capabilityPetAssets'
import type { CapabilityType } from './types'

type RuntimeStatus = 'WAITING' | 'RUNNING' | 'DONE' | 'NEEDS HUMAN' | 'BLOCKED' | 'FAILED' | 'SKIPPED'

type DonaldPetProps = {
  capability?: CapabilityType
  status: RuntimeStatus
  isMoving?: boolean
  size?: number
  className?: string
  label?: string
}

function petVisualState(status: RuntimeStatus, isMoving = false) {
  if (isMoving) return 'moving'

  switch (status) {
    case 'RUNNING':
      return 'working'
    case 'DONE':
      return 'success'
    case 'NEEDS HUMAN':
      return 'needs-human'
    case 'FAILED':
      return 'failed'
    case 'BLOCKED':
    case 'SKIPPED':
      return 'quiet'
    case 'WAITING':
      return 'idle'
  }
}

export function DonaldPet({
  capability,
  status,
  isMoving = false,
  size = 64,
  className = '',
  label,
}: DonaldPetProps) {
  const asset = getCapabilityPetAsset(capability)
  const width = Math.round(size * (asset.width / asset.height))
  const visualState = petVisualState(status, isMoving)

  return (
    <span
      className={`donald-pet donald-pet-${visualState} donald-pet-capability-${capability?.toLowerCase() ?? 'default'} ${className}`}
      style={{ width, height: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      data-capability={capability ?? 'DEFAULT'}
    >
      <Image
        src={asset.src}
        alt=""
        width={asset.width}
        height={asset.height}
        sizes={`${width}px`}
        priority={false}
      />
    </span>
  )
}

export type { CapabilityType, DonaldPetProps, RuntimeStatus }
