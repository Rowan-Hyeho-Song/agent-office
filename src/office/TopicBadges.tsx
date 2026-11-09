import { TOPICS, topicName, type TopicId } from '../docs/topics'
import { pathOf } from './ApprovalIcons'

// The topic badges (#236, docs/design/docs-ui.md 3.6): a 12 px pixel icon + the topic's name, in the topic's colour
// (--topic-<id> in tokens.css). Always icon + text, so colour is never the only cue. Drawn like ApprovalIcons.tsx.

const ICONS: Record<TopicId, readonly string[]> = {
  feature: ['............', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.##########.', '.##########.', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............'],
  bug: ['...#....#...', '....#..#....', '...######...', '...######...', '.###.##.###.', '...######...', '.##########.', '...##..##...', '.##########.', '...######...', '....####....', '............'],
  design: ['...######...', '..##..####..', '.#....#####.', '.#....#####.', '#.....######', '#.....######', '#.....######', '#.....######', '.#....#####.', '.#....#####.', '..##..####..', '...######...'],
  asset: ['.....##.....', '...##..##...', '.##......##.', '#..#....#..#', '#...#..#...#', '#....##....#', '#....##....#', '#....##....#', '.##..##..##.', '...##..##...', '.....##.....', '............'],
  plan: ['.##########.', '.#........#.', '.#.######.#.', '.#........#.', '.#.######.#.', '.#........#.', '.#.######.#.', '.#........#.', '.#.######.#.', '.#........#.', '.##########.', '............'],
  docs: ['..######....', '..#....##...', '..#....#.#..', '..#....####.', '..#.......#.', '..#.......#.', '..#.......#.', '..#.......#.', '..#.......#.', '..#.......#.', '..#########.', '............'],
  perf: ['......###...', '.....###....', '....###.....', '...#######..', '.....###....', '....###.....', '...###......', '..###.......', '..##........', '.#..........', '............', '............'],
  ui: ['############', '############', '############', '#..........#', '#..........#', '#.######...#', '#..........#', '#.####.....#', '#..........#', '#..........#', '############', '............'],
  a11y: ['...######...', '..##....##..', '.#........#.', '#...####...#', '#..##..##..#', '#..#.##.#..#', '#..#.##.#..#', '#..##..##..#', '#...####...#', '.#........#.', '..##....##..', '...######...'],
  sound: ['.....#......', '.....#...#..', '...#.#...#..', '...#.#.#.#..', '.#.#.#.#.#.#', '.#.#.#.#.#.#', '.#.#.#.#.#.#', '.#.#.#.#.#.#', '...#.#.#.#..', '...#.#...#..', '.....#...#..', '.....#......'],
}
const PATHS = Object.fromEntries(TOPICS.map((t) => [t.id, pathOf(ICONS[t.id])])) as Record<TopicId, string>

export function TopicIcon({ id }: { id: TopicId }) {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={PATHS[id]} />
    </svg>
  )
}

/**
 * The badges of one file or document. Nothing when there are no topics. One screen-reader line for the group
 * ("주제: 디자인, 3D"); the badges themselves are hidden from it. `fold`: where the row is narrow (the file list) only
 * the first badge shows and the rest collapse into "+n" (CSS container query, styles.css .topics).
 */
export function TopicBadges({ topics, fold = false }: { topics: readonly TopicId[]; fold?: boolean }) {
  if (!topics.length) return null
  return (
    <span className={`topics${fold ? ' fold' : ''}`}>
      <span className="sr-only">주제: {topics.map(topicName).join(', ')}</span>
      <span className="topic-row" aria-hidden="true">
        {topics.map((id, i) => (
          <span key={id} className="topic" data-topic={id} data-extra={i > 0 ? '' : undefined}>
            <TopicIcon id={id} />
            {topicName(id)}
          </span>
        ))}
        {fold && topics.length > 1 && <span className="topic-more">+{topics.length - 1}</span>}
      </span>
    </span>
  )
}
