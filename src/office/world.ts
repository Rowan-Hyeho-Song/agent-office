// The office's shared runtime state: one per page. The 3D scene writes it every frame, the debug panel reads it.

import { Director, type Goal } from './director'
import { LiveStatusSource } from './liveStatus'
import type { NavGraph } from './nav'
import type { NavCheck } from './navcheck'
import type { AgentRig } from './rig'
import { FakeStatusSource, type StatusSource } from './status'
import { supabase } from './supabase'

/** the four agents = desks 0..3 (#5); agent_<seat> in the glb */
export const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
/** names and colors (#26 결재; same values as --agent-N in src/styles/tokens.css and supabase/office.sql) */
export const AGENT_INFO: Record<string, { name: string; role: string; color: string }> = {
  agent_0: { name: '메모 MEMO', role: '기획', color: '#ffb347' },
  agent_1: { name: '메시 MESH', role: '3D', color: '#8f9bff' },
  agent_2: { name: '휴 HUE', role: '디자인', color: '#ff3ea5' },
  agent_3: { name: '루프 LOOP', role: '코더', color: '#4df3ff' },
}
export const AGENT_COLORS: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a, AGENT_INFO[a].color]))

export interface OfficeWorld {
  debug: boolean
  source: StatusSource
  /** set when the source is the development fake (the debug panel drives it) */
  fake: FakeStatusSource | null
  /** set when the source is the real one (Supabase Realtime) */
  live: LiveStatusSource | null
  director: Director
  /** debug only: shifts the play clock to preview later schedules */
  timeOffsetMs: number
  goals: Record<string, Goal>
  rigs: Record<string, AgentRig>
  graph: NavGraph | null
  check: NavCheck | null
}

export const officeNow = (w: OfficeWorld) => Date.now() + w.timeOffsetMs

/**
 * The status source: the real one when Supabase is configured (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY,
 * read-only key), the hand-driven fake under ?debug=1 (add &live to watch real signals with the debug view),
 * or the fake with everyone idle when nothing is configured (local development).
 */
export function createWorld(debug: boolean, query = new URLSearchParams()): OfficeWorld {
  const live = supabase && (!debug || query.has('live')) ? new LiveStatusSource(supabase, AGENTS) : null
  const fake = live ? null : new FakeStatusSource(AGENTS)
  return {
    debug,
    source: (live ?? fake)!,
    fake,
    live,
    director: new Director(AGENTS),
    timeOffsetMs: 0,
    goals: {},
    rigs: {},
    graph: null,
    check: null,
  }
}
