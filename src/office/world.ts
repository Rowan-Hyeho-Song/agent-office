// The office's shared runtime state: one per page. The 3D scene writes it every frame, the debug panel reads it.

import { Director, type Goal } from './director'
import type { NavGraph } from './nav'
import type { NavCheck } from './navcheck'
import type { AgentRig } from './rig'
import { FakeStatusSource, type StatusSource } from './status'

/** the four placeholder agents in the glb until the roster is decided (#5) */
export const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
/** their accent colors in the model (office_bake.py AGENTS) */
export const AGENT_COLORS: Record<string, string> = {
  agent_0: '#4df3ff',
  agent_1: '#ff3ea5',
  agent_2: '#ffb347',
  agent_3: '#7dff9b',
}

export interface OfficeWorld {
  debug: boolean
  source: StatusSource
  /** set when the source is the development fake (the debug panel drives it) */
  fake: FakeStatusSource | null
  director: Director
  /** debug only: shifts the play clock to preview later schedules */
  timeOffsetMs: number
  goals: Record<string, Goal>
  rigs: Record<string, AgentRig>
  graph: NavGraph | null
  check: NavCheck | null
}

export const officeNow = (w: OfficeWorld) => Date.now() + w.timeOffsetMs

export function createWorld(debug: boolean): OfficeWorld {
  // the only source today; #1 swaps in the Supabase Realtime one behind the same interface
  const fake = new FakeStatusSource(AGENTS)
  const world: OfficeWorld = {
    debug,
    source: fake,
    fake,
    director: new Director(AGENTS),
    timeOffsetMs: 0,
    goals: {},
    rigs: {},
    graph: null,
    check: null,
  }
  return world
}
