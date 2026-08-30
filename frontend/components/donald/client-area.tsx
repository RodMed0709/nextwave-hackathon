'use client'

import type { ClientProjectMetadata } from '@/lib/donald/operational-stages'

type ClientAreaProps = {
  metadata: ClientProjectMetadata
  activeAgent: string | null
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

export function ClientArea({ metadata, activeAgent, currentTask }: ClientAreaProps) {
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
      <div className="client-meta-field connected-agents-field">
        <span>Connected Nauta</span>
        <div className="agent-chip-list">
          {metadata.agents.length === 0 && <strong>Unavailable</strong>}
          {metadata.agents.map((agent) => (
            <span
              className={agent.label === activeAgent ? 'agent-chip active' : 'agent-chip'}
              key={`${agent.label}-${agent.role ?? 'agent'}`}
              title={agent.role ?? agent.label}
            >
              {agent.label}{agent.role ? ` / ${agent.role}` : ''}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
