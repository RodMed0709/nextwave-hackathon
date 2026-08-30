'use client'

import type { ClientProjectMetadata } from '@/lib/donald/operational-stages'

type ClientAreaProps = {
  metadata: ClientProjectMetadata
  currentTask: string
}

export function ClientArea({ metadata, currentTask }: ClientAreaProps) {
  return (
    <section className="client-area" aria-label="Client area">
      <div className="client-priority-stack">
        <div className="client-meta-field strong" title={metadata.business ?? undefined}>
          <span>Client</span>
          <strong>{metadata.clientName ?? 'Mueblerías Berríos — Puerto Rico'}</strong>
        </div>
        <div className="current-task-block">
          <span>The objective</span>
          <strong>{currentTask}</strong>
        </div>
      </div>
    </section>
  )
}
