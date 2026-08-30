import { canIntervene } from './presentation'
import type { RunState } from './types'

/**
 * Which node a run-level instruction should land on.
 *
 * The prompt bar and the Adjust control both speak about "the run", but the
 * intervention API is addressed per node, so someone has to pick one. The
 * chain mirrors how an operator reads the screen: the step already asking for
 * a human wins, then whatever is next in line, then whatever is visibly
 * running, then any step still open at all.
 */
export function pickSteerTargetKey(
  state: Pick<RunState, 'nodes' | 'open_intervention'>,
  nextTaskKeys: readonly string[],
  visiblyActiveKeys: readonly string[],
): string | null {
  const steerable = (key: string) => Boolean(state.nodes[key] && canIntervene(state.nodes[key]))
  return state.open_intervention?.node_key ??
    nextTaskKeys.find(steerable) ??
    visiblyActiveKeys.find(steerable) ??
    Object.values(state.nodes).find((node) => canIntervene(node))?.node_key ??
    null
}
