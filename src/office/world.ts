// The office's shared runtime state: one per page. The 3D scene writes it every frame, the debug panel reads it.

import type { ApprovalSource } from '../approvals/source'
import { setClockFromText, setClockTime } from './clock'
import { DutySource } from './duty'
import { kstTimeToMs } from './kst'
import { FakeApprovalSource } from '../approvals/fakeSource'
import { supabaseSource } from './approval/supabaseSource'
import { openApprovalBox } from './approval/panel'
import { openDocs } from './docs/panel'
import { supabaseDocsSource } from './docs/supabaseSource'
import { FakeDocsSource } from '../docs/fakeSource'
import { LibraryStore } from '../docs/store'
import { FakeBoard } from '../board/fake'
import { feedBoardFromLibrary } from '../board/feed'
import { BoardStore } from '../board/store'
import type { Ref } from '../docs/library'
import { Director, type Goal } from './director'
import { BubbleCenter } from './bubbleCenter'
import { MeetingRunner } from './meetingRun'
import { ReplayControl } from './replay'
import { splitDecision } from '../board/state'
import { LiveStatusSource } from './liveStatus'
import type { NavGraph } from './nav'
import type { NavCheck } from './navcheck'
import type { PaperPlanes } from './plane'
import type { AgentRig } from './rig'
import { FakePropsFeed, LivePropsFeed, type PropsFeed } from './propsFeed'
import { FakeStatusSource, type StatusSource } from './status'
import type { ScreenForce } from './screenLive'
import type { ScreenState } from './screens'
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

/**
 * Debug only (#75): force a monitor into one of the five states, window.__office.screens.
 *   set(seat | 'all', 'work' | 'wrap' | 'rest' | 'off' | 'private' | null, activity?)  null = back to the real status
 *   stats()  { uploads, fullDraws, stripDraws } counted by the screens since the page started
 */
export class ScreenDebug {
  force: Partial<Record<number, ScreenForce>> = {}
  /** set by the scene */
  counters: () => { uploads: number; fullDraws: number; stripDraws: number; ms: number } = () => ({ uploads: 0, fullDraws: 0, stripDraws: 0, ms: 0 })
  /** set by the scene: where each monitor is (for placing a screenshot camera) */
  centers: () => number[][] = () => []
  set(seat: number | 'all', state: ScreenState | null, activity?: string) {
    for (const s of seat === 'all' ? [0, 1, 2, 3] : [seat]) {
      if (state) this.force[s] = { state, activity }
      else delete this.force[s]
    }
  }
  stats() {
    return this.counters()
  }
}

export interface OfficeWorld {
  debug: boolean
  /** what the office reads: the raw source with day / night applied (duty.ts) */
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
  /** the whiteboard's data (#66): from the library, or the debug fake when the library is the fake */
  board: BoardStore
  /** set under ?debug=1 with the fake library: window.__office.fakeBoard.add(n, title, seat, col) / .move(n, col) / .decide(title, note, n) / .secret(n) */
  fakeBoard: FakeBoard | null
  /** debug only: force the monitor screens (ScreenDebug) */
  screens: ScreenDebug
  /** debug only: window.__office.clock.set('10:10') pins the wall clock (Seoul time), set('') releases it */
  clock: { set(text: string): void } | null
  /**
   * debug only (#110): window.__office.kst.set('02:00') makes the office believe it is 02:00 in Seoul (day / night,
   * the play schedule and the wall clock; it keeps ticking from there), set('') goes back to real time.
   * ?debug=1&kst=02:00 does the same at load.
   */
  kst: { set(text: string): void } | null
  /** day / night applied on top of the raw status source (what `source` is) */
  duty: DutySource
  director: Director
  /** bubbles outside a replay (#97): window.__office.bubbles.say(agent, { kind: 'talk' | 'react' | 'private', text }) */
  bubbles: BubbleCenter
  /** the meeting replay player (#97, reused by the timelapse #82): .onDecisionPinned(cb), .onEnd(cb), .view(now) */
  meeting: MeetingRunner
  /** what starts replays (null without a library): window.__office.replay.minutes(n) / .secret() / .private() / .pick(at?) / .stop() */
  replay: ReplayControl | null
  /** debug only: shifts the play clock to preview later schedules */
  timeOffsetMs: number
  goals: Record<string, Goal>
  rigs: Record<string, AgentRig>
  /** the paper planes in flight (#51), set by the scene */
  planes: PaperPlanes | null
  graph: NavGraph | null
  check: NavCheck | null
}

function setKst(w: OfficeWorld, text: string) {
  const ms = kstTimeToMs(text)
  w.timeOffsetMs = ms === null ? 0 : ms - Date.now()
  setClockTime(ms === null ? null : new Date(ms))
  w.duty.refresh()
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
  const board = new BoardStore()
  const fakeBoard = docs ? new FakeBoard(board) : null
  if (library && !fakeBoard) feedBoardFromLibrary(library, board)
  const meeting = new MeetingRunner()
  const holder: { w?: OfficeWorld } = {}
  const duty = new DutySource((live ?? fake)!, AGENTS, () => Date.now() + (holder.w?.timeOffsetMs ?? 0))
  const world: OfficeWorld = {
    debug,
    board,
    fakeBoard,
    approvals,
    fakeApprovals,
    library,
    docs,
    source: duty,
    duty,
    fake,
    live,
    props: live && supabase ? new LivePropsFeed(supabase) : fakeProps!,
    fakeProps,
    screens: new ScreenDebug(),
    clock: debug ? { set: setClockFromText } : null,
    kst: debug ? { set: (text) => setKst(world, text) } : null,
    director: new Director(AGENTS),
    bubbles: new BubbleCenter(),
    meeting,
    replay: null,
    timeOffsetMs: 0,
    goals: {},
    rigs: {},
    planes: null,
    graph: null,
    check: null,
  }
  holder.w = world
  if (debug) setKst(world, query.get('kst') ?? '')
  if (library) {
    // the hourly idle replay is off under ?debug=1 unless &replay is in the address, so screenshots stay still
    world.replay = new ReplayControl(library, meeting, { now: () => officeNow(world), status: () => world.source.getSnapshot(), reduced: prefersReducedMotion }, !debug || query.get('replay') === '')
    world.replay.watch()
  }
  // the planner pins the decision on the whiteboard: the note fades in like any new one (#66)
  meeting.onDecisionPinned(({ script, text }) => {
    const s = splitDecision(text)
    board.pin({ key: `meeting:${script.id}`, repo: script.repo, n: script.n, title: s.title, note: s.note, at: new Date().toISOString() })
  })
  return world
}

/** the same rule as the design tokens: html[data-motion="reduce"|"full"] wins, otherwise the OS setting */
export function prefersReducedMotion(): boolean {
  const forced = document.documentElement.dataset.motion
  if (forced === 'reduce' || forced === 'full') return forced === 'reduce'
  return matchMedia('(prefers-reduced-motion: reduce)').matches
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
