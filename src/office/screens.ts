// What a work monitor shows (docs/design/office-ui.md 4.2). Pure: an agent's status in, a draw list out; the canvas
// code (screenLive.ts) only interprets the list, so "a private screen never carries the activity" is testable here.

import { activityLabel, type AgentStatus } from './status'

export type ScreenState = 'work' | 'wrap' | 'rest' | 'off' | 'private'
export const SCREEN_STATES: ScreenState[] = ['work', 'wrap', 'rest', 'off', 'private']

/** 12 x 12 bitmaps (# = filled): the original is the design mock's ICONS; the canvas scales them by whole factors only */
export const ICONS = {
  edit: ['..........##', '.........###', '........###.', '.......###..', '......###...', '.....###....', '....###.....', '...###......', '..###.......', '.##.........', '.#..........', '............'],
  cmd: ['............', '############', '#..........#', '#.#........#', '#..#.......#', '#...#......#', '#..#.......#', '#.#...###..#', '#..........#', '############', '............', '............'],
  test: ['...######...', '....#..#....', '....#..#....', '....#..#....', '...#....#...', '..#......#..', '.#..####..#.', '.#.######.#.', '#.########.#', '#.########.#', '############', '............'],
  read: ['..####......', '.#....#.....', '#......#....', '#......#....', '#......#....', '#......#....', '.#....##....', '..#####.#...', '.......###..', '........###.', '.........###', '..........##'],
  build: ['..#######...', '.########...', '..#######...', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '....####....', '............'],
  install: ['.....##.....', '.....##.....', '.....##.....', '.....##.....', '..########..', '...######...', '....####....', '.....##.....', '#..........#', '#..........#', '############', '............'],
  git: ['..##........', '.####.......', '..##........', '..##....##..', '..##...####.', '..##....##..', '..##...##...', '..##..##....', '..####......', '..##........', '.####.......', '..##........'],
  run: ['............', '..##........', '..####......', '..######....', '..########..', '..#########.', '..#########.', '..########..', '..######....', '..####......', '..##........', '............'],
  delegate: ['#####.......', '#...##......', '#....#......', '#.##.#......', '#....#...#..', '#.##.#...##.', '#....######.', '#.##.#...##.', '#....#...#..', '######......', '............', '............'],
  card: ['............', '############', '#..........#', '#.##.#####.#', '#..........#', '#.##.#####.#', '#..........#', '#.##.###...#', '#..........#', '############', '............', '............'],
  lock: ['...######...', '..#......#..', '..#......#..', '..#......#..', '############', '############', '####....####', '####....####', '#####..#####', '#####..#####', '############', '############'],
  coffee: ['............', '..#..#..#...', '...#..#..#..', '............', '##########..', '#........###', '#........#.#', '#........#.#', '#........###', '.#......#...', '..######....', '############'],
  power: ['.....##.....', '.....##.....', '..#..##..#..', '.#...##...#.', '#....##....#', '#..........#', '#..........#', '#..........#', '.#........#.', '..#......#..', '...######...', '............'],
  arrow: ['............', '.....#......', '....##......', '...###......', '..##########', '.###########', '.###########', '..##########', '...###......', '....##......', '.....#......', '............'],
  heart: ['............', '.###...###..', '#####.#####.', '###########.', '###########.', '###########.', '.#########..', '..#######...', '...#####....', '....###.....', '.....#......', '............'],
  think: ['............', '.##########.', '#..........#', '#..........#', '#.##.##.##.#', '#.##.##.##.#', '#..........#', '.##########.', '..##........', '..#.........', '.#..........', '............'],
  bot: ['.....##.....', '.....##.....', '.##########.', '#..........#', '#.##....##.#', '#.##....##.#', '#..........#', '#...####...#', '#..........#', '.##########.', '...#....#...', '..##....##..'],
} as const
export type IconName = keyof typeof ICONS

/** the hook's activity names -> icon (same table as the mock's ACTIVITIES; an activity missing here shows cmd) */
const ACTIVITY_ICON: Record<string, IconName> = {
  edit: 'edit',
  read: 'read',
  test: 'test',
  build: 'build',
  install: 'install',
  git: 'git',
  run: 'run',
  other: 'cmd',
  delegate: 'delegate',
  think: 'think',
}

/** a working agent whose hook says the session is outside the office's projects (#34) shows the private screen */
export function screenState(s: Pick<AgentStatus, 'state' | 'activity'> | undefined): ScreenState {
  if (!s || s.state === 'off') return 'off'
  if (s.state === 'idle') return 'rest'
  if (s.state === 'wrapping') return 'wrap'
  return s.activity === 'private' ? 'private' : 'work'
}

export type Op =
  | { op: 'bg'; tone: 'agent' | 'rest' | 'lock' | 'off' }
  | { op: 'hatch' }
  | { op: 'head'; tone: 'ink' | 'lock' }
  | { op: 'icon'; icon: IconName; tone: 'ink' | 'lock' }
  | { op: 'label'; text: string; tone: 'text' | 'lock' }
  | { op: 'strip'; tone: 'agent' | 'lock' }
  | { op: 'elapsed' }
  | { op: 'fields' }
  | { op: 'saver' }
  | { op: 'restFoot' }
  | { op: 'standby' }
  | { op: 'led' }

/**
 * The draw list for a state. `activity` only matters for 'work'; the private list is the same whatever the agent
 * is doing: no activity words, no tool icon, just the lock, the fixed "비공개 작업 중", and the strip that says
 * "working right now".
 */
export function screenPlan(state: ScreenState, activity?: string): Op[] {
  switch (state) {
    case 'work':
      return [
        { op: 'bg', tone: 'agent' },
        { op: 'head', tone: 'ink' },
        { op: 'icon', icon: (activity && ACTIVITY_ICON[activity]) || 'cmd', tone: 'ink' },
        { op: 'label', text: activityLabel(activity), tone: 'text' },
        { op: 'strip', tone: 'agent' },
        { op: 'elapsed' },
      ]
    case 'wrap':
      return [
        { op: 'bg', tone: 'agent' },
        { op: 'head', tone: 'ink' },
        { op: 'icon', icon: 'card', tone: 'ink' },
        { op: 'label', text: '카드 정리 중', tone: 'text' },
        { op: 'fields' },
      ]
    case 'rest':
      return [{ op: 'bg', tone: 'rest' }, { op: 'saver' }, { op: 'restFoot' }]
    case 'off':
      return [{ op: 'bg', tone: 'off' }, { op: 'standby' }, { op: 'led' }]
    case 'private':
      return [
        { op: 'bg', tone: 'lock' },
        { op: 'hatch' },
        { op: 'head', tone: 'lock' },
        { op: 'icon', icon: 'lock', tone: 'lock' },
        { op: 'label', text: '비공개 작업 중', tone: 'lock' },
        { op: 'strip', tone: 'lock' },
        { op: 'elapsed' },
      ]
  }
}

/** the ops that animate on their own: an unchanged state only repaints these, in the bottom band (design 4.3) */
export const LIVE_OPS: ReadonlySet<Op['op']> = new Set(['strip', 'elapsed', 'fields'])
/** rest and off have no still part: they are redrawn whole, and only when their phase changes */
export const hasStill = (plan: Op[]) => plan.some((o) => o.op === 'head')

export const WRAP_FIELDS = ['목표', '한 일', '결정', '다음'] as const
