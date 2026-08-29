import type { CapabilityType } from './types'

export type CapabilityPetAsset = {
  src: string
  width: number
  height: number
  alt: string
}

export const defaultDonaldPetAsset: CapabilityPetAsset = {
  src: '/donald-pet/donald-default.webp',
  width: 168,
  height: 260,
  alt: 'Donald operational assistant',
}

export const capabilityPetAssets: Record<CapabilityType, CapabilityPetAsset> = {
  INGEST: {
    src: '/donald-pet/capabilities/ingest.webp',
    width: 168,
    height: 260,
    alt: 'Donald reading operational information',
  },
  IDENTIFY: defaultDonaldPetAsset,
  EXTRACT: defaultDonaldPetAsset,
  RECONCILE: defaultDonaldPetAsset,
  MONITOR: defaultDonaldPetAsset,
  PREDICT: defaultDonaldPetAsset,
  DETECT: defaultDonaldPetAsset,
  EXPLAIN: defaultDonaldPetAsset,
  IMPACT: defaultDonaldPetAsset,
  PLAN: defaultDonaldPetAsset,
  DECIDE: defaultDonaldPetAsset,
  ACT: defaultDonaldPetAsset,
}

export function getCapabilityPetAsset(capability?: CapabilityType): CapabilityPetAsset {
  return capability ? capabilityPetAssets[capability] : defaultDonaldPetAsset
}
