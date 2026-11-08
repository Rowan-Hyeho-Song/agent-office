// The development fake behind ?debug=1 (never used otherwise): the mock's board (docs-ui.html: 진행 중 4, 검토 2,
// 완료 7, 결정 3) and hand-driven edits, so the fade-in and the +N can be watched. window.__office.fakeBoard.

import { BoardStore } from './store'
import { COLUMNS, asSeat, emptyBoard, type BoardCard, type BoardState, type Column } from './state'

const REPO = 'owner/agent-office'
const T0 = Date.UTC(2026, 10, 8, 0, 0, 0)

export class FakeBoard {
  private state: BoardState = emptyBoard()
  private tick = 0
  constructor(private store: BoardStore) {
    const seed = (col: Column, rows: [number, number, string][]) => [...rows].reverse().forEach(([seat, n, title]) => this.add(n, title, seat, col, false))
    seed('doing', [[1, 27, '머리·손 모델'], [1, 43, '책상 소품 모델'], [3, 44, '책상 LIVE 연결'], [2, 45, '결재함 · 문서 화면']])
    seed('review', [[3, 25, '주인 로그인 + 결재'], [3, 17, '이동·놀이']])
    seed('done', [[2, 32, '자리별 책상 꾸미기'], [2, 28, '떠 있는 머리 + 두 손'], [3, 24, '문서 수집'], [1, 20, '놀이 소품'], [0, 19, '캐릭터 시안'], [3, 12, '상태 신호'], [0, 3, '사무실 공간']])
    const notes: [string, string, number][] = [['손 모양 A', '엄지·검지 장갑', 28], ['책상 승인', '신호등 성공/실패 값 허용', 32], ['종이비행기', '짧은 일 넘기기', 28]]
    notes.reverse().forEach(([t, note, n]) => this.decide(t, note, n, false))
    this.push()
  }
  private at = () => new Date(T0 + ++this.tick * 60_000).toISOString()
  private push() {
    this.store.set({ ...this.state })
  }
  /** add (or re-add) a card on top of a column: window.__office.fakeBoard.add(60, '새 카드', 3, 'doing') */
  add(n: number, title: string, seat: number | null = 3, col: Column = 'doing', push = true) {
    this.remove(n)
    const card: BoardCard = { key: `${REPO}#${n}`, repo: REPO, n, title, seat: asSeat(seat), at: this.at() }
    this.state = { ...this.state, [col]: [card, ...this.state[col]] }
    if (push) this.push()
  }
  /** move a card to the top of another column (it fades in there): window.__office.fakeBoard.move(44, 'review') */
  move(n: number, col: Column) {
    const card = COLUMNS.flatMap((c) => this.state[c]).find((k) => k.n === n)
    if (!card) return
    this.remove(n)
    this.state = { ...this.state, [col]: [{ ...card, at: this.at() }, ...this.state[col]] }
    this.push()
  }
  /** a SECRET card (black bar title): window.__office.fakeBoard.secret(77) */
  secret(n: number, col: Column = 'review') {
    this.add(n, '', 3, col, false)
    this.state = { ...this.state, [col]: this.state[col].map((k) => (k.n === n ? { ...k, title: null } : k)) }
    this.push()
  }
  /** a new decision note on top: window.__office.fakeBoard.decide('큰 글씨', '보충', 66) */
  decide(title: string, note: string | null = null, n: number | null = null, push = true) {
    this.state = { ...this.state, decisions: [{ key: `decision:${this.tick}:${title}`, repo: REPO, n, title, note, at: this.at() }, ...this.state.decisions] }
    if (push) this.push()
  }
  remove(n: number) {
    this.state = { ...this.state, doing: this.state.doing.filter((k) => k.n !== n), review: this.state.review.filter((k) => k.n !== n), done: this.state.done.filter((k) => k.n !== n) }
  }
}
