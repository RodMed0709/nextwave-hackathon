'use client'

import type { ConnectedAgent } from '@/lib/donald/operational-stages'

/**
 * The Nauta agents as a fixed vertical rail: always in view, and the one
 * working right now lights up. Replaces the cramped header chip row.
 */
export function AgentRail({ agents, active }: { agents: ConnectedAgent[]; active: Set<string> }) {
  if (agents.length === 0) return null
  return (
    <aside aria-label="Connected Nauta agents" className="agent-rail">
      <span className="agent-rail-title">Nauta agents</span>
      {agents.map((agent) => {
        const working = active.has(agent.label)
        return (
          <div className={working ? 'agent-rail-item working' : 'agent-rail-item'} key={agent.label} title={agent.role ?? agent.label}>
            <i aria-hidden="true" />
            <div>
              <strong>{agent.label}</strong>
              {agent.role && <small>{agent.role}</small>}
            </div>
          </div>
        )
      })}
    </aside>
  )
}
