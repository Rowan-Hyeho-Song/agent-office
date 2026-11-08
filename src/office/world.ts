// The office's shared runtime state: one per page. The 3D scene writes it every frame, the debug panel reads it.

import type { ApprovalSource } from '../approvals/source'
import { FakeApprovalSource } from '../approvals/fakeSource'
import { supabaseSource } from './approval/supabaseSource'
import { openApprovalBox } from './approval/panel'
import { openDocs } from './docs/panel'
import { supabaseDocsSource } from './docs/supabaseSource'
import { FakeDocsSource } from '../docs/fakeSource'
import { LibraryStore } from '../docs/store'
import type { Ref } from '../docs/library'
import { Director, type Goal } from './director'
import { LiveStatusSource } from './liveStatus'
import type { NavGraph } from './nav'
import type { NavCheck } from './navcheck'
import type { PaperPlanes } from './plane'
import type { AgentRig } from './rig'
import { FakePropsFeed, LivePropsFeed, type PropsFeed } from './propsFeed'
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
  /** the LIVE desk props' other inputs (#44); fakeProps is set alongside fake */
  props: PropsFeed
  fakeProps: FakePropsFeed | null
  /** the approval box data (#64): Supabase, the debug fake, or null when the office is not configured */
  approvals: ApprovalSource | null
  /** set when approvals is the debug fake: window.__office.fakeApprovals.as('owner' | 'visitor'), .failNext(), .open() */
  fakeApprovals: FakeApprovalSource | null
  /** the library (#65): documents for the current role, read by the viewer and the bookshelf; null when the office is not configured */
  library: LibraryStore | null
  /** set when the library is the debug fake: window.__office.docs.as('owner' | 'visitor'), .open(n, kind, row), .publish(id) */
  docs: FakeDocsSource | null
  director: Director
  /** debug only: shifts the play clock to preview later schedules */
  timeOffsetMs: number
  goals: Record<string, Goal>
  rigs: Record<string, AgentRig>
  /** the paper planes in flight (#51), set by the scene */
  planes: PaperPlanes | null
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
  const fakeProps = live ? null : new FakePropsFeed()
  // the fake only under ?debug=1 (and not &live): the shipped page never gets it
  const fakeApprovals = debug && !(live && supabase) ? new FakeApprovalSource() : null
  const approvals = fakeApprovals ?? (supabase ? supabaseSource(supabase) : null)
  if (fakeApprovals) {
    fakeApprovals.openPanel = openApprovalBox
    // ?debug=1&approvals=owner|visitor: start in that view with the panel open
    const as = query.get('approvals')
    if (as === 'owner' || as === 'visitor') {
      fakeApprovals.as(as)
      openApprovalBox()
    }
  }
  const { library, docs } = createLibrary(approvals, fakeApprovals, debug && !(live && supabase), query)
  return {
    debug,
    approvals,
    fakeApprovals,
    library,
    docs,
    source: (live ?? fake)!,
    fake,
    live,
    props: live && supabase ? new LivePropsFeed(supabase) : fakeProps!,
    fakeProps,
    director: new Director(AGENTS),
    timeOffsetMs: 0,
    goals: {},
    rigs: {},
    planes: null,
    graph: null,
    check: null,
  }
}

/** the library: Supabase, or under ?debug=1 the fake (shares the approval fake's role). ?debug=1&docs=owner|visitor opens the viewer */
function createLibrary(approvals: ApprovalSource | null, fakeApprovals: FakeApprovalSource | null, fake: boolean, query: URLSearchParams) {
  const docs = fake ? new FakeDocsSource() : null
  const source = docs ?? (supabase ? supabaseDocsSource(supabase) : null)
  if (!source || !approvals) return { library: null, docs: null }
  const library = new LibraryStore(source, () => approvals.role())
  const refresh = () => void library.refresh()
  refresh()
  approvals.subscribe(refresh)
  source.subscribe?.(refresh)
  // the page only ever polls, never subscribes to documents: an hour-old list is fine, a minute-old one is better
  setInterval(() => !document.hidden && refresh(), 60_000)
  if (docs && fakeApprovals) {
    docs.setRole = (r) => fakeApprovals.as(r)
    docs.openViewer = ({ n, kind, row, repo, id }) => {
      const ref: Ref = id !== undefined ? { id } : { n, repo: repo ?? library.getSnapshot().metas?.find((m) => m.folder === n)?.repo ?? undefined, kind: kind as Ref['kind'], row }
      openDocs(ref)
    }
    const as = query.get('docs')
    if (as === 'owner' || as === 'visitor') {
      fakeApprovals.as(as)
      openDocs()
    }
  }
  return { library, docs }
}
