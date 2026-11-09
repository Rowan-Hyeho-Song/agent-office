// The development fake behind ?debug=1 (never used otherwise): sample approvals of every kind and a hand-driven
// role, so the box can be built and screenshotted without Supabase. Driven from window.__office.approvals.

import { needsOpinion, readChoice } from './approve.js'
import type { ApprovalSource, Cover, DecideResult, DecidedCover, Role } from './source.js'
import type { StoredApproval } from './types.js'
import { oldestFirst } from './view.js'

const REPO = 'Rowan-Hyeho-Song/agent-office'
const at = (h: number, m: number) => new Date(2026, 10, 8, h, m).toISOString()

const row = (over: Partial<StoredApproval>): StoredApproval => ({
  id: 0,
  repo: REPO,
  folder: 1,
  title: '',
  source_url: `https://github.com/${REPO}/issues/1#issuecomment-1`,
  kind: '결정 요청',
  requester: '',
  requester_seat: 0,
  content: '',
  options: [],
  recommended: null,
  reason: null,
  created_at: at(1, 0),
  updated_at: at(1, 0),
  status: 'pending',
  result: null,
  option: null,
  opinion: null,
  result_url: null,
  decided_at: null,
  ...over,
})

export const SAMPLES: StoredApproval[] = [
  row({
    id: 1,
    folder: 28,
    title: '몸통 없는 에이전트: 떠 있는 머리 + 떠 있는 두 손',
    kind: '결정 요청',
    requester_seat: 2,
    created_at: at(1, 55),
    content:
      '떠 있는 두 손의 모양을 골라 주세요. 네 명 모두 손 버릇에 **검지**를 따로 씁니다.\n\n- 메모: 머리를 톡톡\n- 메시: 사각 프레임\n- 휴: 스포이트\n- 루프: 화면 가리키기\n\n자세한 비교는 [이슈](https://github.com/Rowan-Hyeho-Song/agent-office/issues/28)에 있어요.',
    options: [
      'A 엄지·검지 장갑: 손바닥 + 엄지 + 검지 + 나머지 세 손가락 한 덩어리',
      'B 벙어리장갑: 손바닥 + 엄지',
      'C 만화 네 손가락: 손바닥 + 손가락 넷',
    ],
    recommended: 1,
    reason: 'A는 네 명의 손 버릇을 모두 하면서 부품이 4조각(회전축 3)으로 적습니다. B는 가리키기를 못 하고, C는 `손가락`이 17px 남짓이라 A와 차이가 안 보입니다.',
  }),
  row({
    id: 2,
    folder: 32,
    title: '자리별 책상 꾸미기: 각 에이전트가 고른 소품 반영',
    kind: '산출물 확인',
    requester_seat: 2,
    created_at: at(2, 9),
    content:
      '네 에이전트가 고른 책상 소품을 배치했습니다.\n\n| 자리 | 소품 | 뺀 것 |\n|---|---|---|\n| 메모 | IN/OUT 서류함, 결재 도장, 달력, 모래시계 | 머그, 화분 |\n| 메시 | 턴테이블, 컬러 체커, 링 조명, 기본 도형 | 서류 더미 |\n| 휴 | 색견본 부채, 펜 태블릿, 다육이, 램프 | 머그, 마우스 |\n| 루프 | 신호등 램프, 고무 오리, 세로 모니터 | 머그, 서류 |',
    reason: '키보드 앞 손 자리를 비워 손 동작을 막지 않고, 소품을 양 끝에 모아 일할 때도 보입니다.',
  }),
  row({
    id: 3,
    repo: 'Rowan-Hyeho-Song/rowansong.dev',
    folder: 3,
    title: '로봇 대사가 끝날 때까지 다른 상호작용이 덮지 않게',
    kind: '문서 공개',
    requester_seat: 3,
    created_at: at(2, 20),
    content: '`rowansong.dev` #3 보고서가 SECRET(review)입니다. 공개할까요? 서버 필터에 걸린 곳은 없습니다.',
    reason: '개인 포트폴리오 저장소의 버그 수정 보고서라 숨길 내용이 없습니다.',
  }),
  row({
    id: 4,
    folder: 26,
    title: '에이전트 4명의 정체성: 이름 안',
    kind: '결정 요청',
    requester_seat: 2,
    created_at: at(1, 24),
    options: ['메모 · 메시 · 휴 · 루프'],
    status: 'decided',
    result: '선택지 1',
    option: 1,
    decided_at: at(1, 30),
    result_url: `https://github.com/${REPO}/issues/26#issuecomment-2`,
  }),
]

export class FakeApprovalSource implements ApprovalSource {
  private r: Role = 'visitor'
  private rows = SAMPLES.map((s) => ({ ...s }))
  private fail = 0
  private listeners = new Set<() => void>()
  /** set by the page: opens the panel (so a screenshot script can call approvals.open()) */
  openPanel: () => void = () => {}

  role = () => this.r
  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  /** debug: switch between the visitor and the owner view */
  as(role: Role) {
    this.r = role
    this.listeners.forEach((l) => l())
  }
  /** debug: the next decide() fails (shows the error state) */
  failNext(n = 1) {
    this.fail = n
  }
  /** debug: back to the sample data */
  reset() {
    this.rows = SAMPLES.map((s) => ({ ...s }))
    this.fail = 0
  }
  open() {
    this.openPanel()
  }
  signIn = () => this.as('owner')
  signOut = () => this.as('visitor')

  private waiting = () => this.rows.filter((a) => a.status !== 'decided')
  count = async () => this.waiting().length
  covers = async (): Promise<Cover[]> =>
    oldestFirst(this.waiting()).map(({ id, kind, requester_seat, created_at }) => ({ id, kind, requester_seat, created_at }))
  decidedCovers = async (): Promise<DecidedCover[]> =>
    this.rows
      .filter((a) => a.status === 'decided' && a.result && a.decided_at)
      .map((a) => ({ id: a.id, kind: a.kind, requester_seat: a.requester_seat, result: a.result as string, decided_at: a.decided_at as string }))
  pending = async () => oldestFirst(this.waiting()).map((a) => ({ ...a }))
  decided = async () => this.rows.filter((a) => a.status === 'decided').map((a) => ({ ...a }))

  async decide(id: number, result: string, opinion: string): Promise<DecideResult> {
    if (this.r !== 'owner') return { ok: false, status: 403 }
    if (this.fail > 0) {
      this.fail--
      return { ok: false, status: 500 }
    }
    const a = this.rows.find((x) => x.id === id)
    if (!a) return { ok: false, status: 404 }
    if (a.status === 'decided') return { ok: false, status: 409 }
    const choice = readChoice(a, result)
    if (!choice) return { ok: false, status: 400 }
    if (needsOpinion(choice.result) && !opinion.trim()) return { ok: false, status: 400 }
    Object.assign(a, {
      status: 'decided',
      result: choice.result,
      option: choice.option,
      opinion: opinion.trim() || null,
      decided_at: new Date().toISOString(),
      result_url: `https://github.com/${a.repo}/issues/${a.folder}#issuecomment-99`,
    })
    return { ok: true }
  }
}
