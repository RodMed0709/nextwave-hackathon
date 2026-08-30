import type { OperationalStageSummary } from '@/lib/donald/operational-stages'

type DonaldNarrationProps = {
  stages: OperationalStageSummary[]
}

export function DonaldNarration({ stages }: DonaldNarrationProps) {
  const above = stages.find((stage) => stage.id === 'above')
  const below = stages.find((stage) => stage.id === 'below')
  const needsHuman = below?.state === 'needs-human' || above?.state === 'needs-human'
  const targetedActive = below ? ['needs-human', 'in-progress'].includes(below.state) : false
  const ambientActive = above && above.totalActions > 0
  const narration = needsHuman
    ? "I've completed the investigation and need your decision before I act."
    : targetedActive
      ? "Monitoring surfaced a signal. I'm investigating it below the line."
      : ambientActive
        ? "I'm continuously monitoring this operation. Nothing currently requires targeted action."
        : "I'm ready to monitor this operation as runtime activity arrives."

  return (
    <section className="donald-narration-band" aria-label="Donald narration">
      <p className="donald-narration">{narration}</p>
    </section>
  )
}
