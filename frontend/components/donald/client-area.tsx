'use client'

import type { ClientProjectMetadata } from '@/lib/donald/operational-stages'

type ClientAreaProps = {
  metadata: ClientProjectMetadata
  currentTask: string
}

function MetaField({ label, value, detail, strong = false }: { label: string; value: string | null; detail?: string | null; strong?: boolean }) {
  return (
    <div className={strong ? 'client-meta-field strong' : 'client-meta-field'}>
      <span>{label}</span>
      <strong>{value ?? 'Unavailable'}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}

export function ClientArea({ metadata, currentTask }: ClientAreaProps) {
  return (
    <section className="client-area" aria-label="Client area">
      <div className="client-priority-stack">
        <MetaField label="Client" value={metadata.clientName} detail={metadata.business} strong />
        <MetaField label="Project Goal" value={metadata.projectGoal} />
        <div className="current-task-block">
          <span>Current Task</span>
          <strong>{currentTask}</strong>
        </div>
      </div>
    </section>
  )
}
