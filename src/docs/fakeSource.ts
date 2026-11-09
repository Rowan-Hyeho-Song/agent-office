// The development fake behind ?debug=1 (never used otherwise): sample folders and documents of every kind, SECRET ones
// included, and a hand-driven role, so the viewer and the bookshelf can be built and screenshotted without Supabase.
// It answers like the server does (coverOf / ownerMeta for lists, RLS-like rules for bodies), so what it hides here is
// hidden by the same rules. Driven from window.__office.docs.

import type { Role } from '../approvals/source.js'
import { coverOf, ownerMeta, type CoverSource, type DocBody, type DocMeta } from './library.js'
import type { DocsSource } from './source.js'
import type { ApprovalRequest, ApprovalResult, Minutes, Speaker } from './types.js'

type Row = CoverSource & { body: string; data: Record<string, unknown>; source_url: string }

const AO = 'Rowan-Hyeho-Song/agent-office'
const RD = 'Rowan-Hyeho-Song/rowansong.dev'
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()
let nextId = 1

const row = (over: Partial<Row> & Pick<Row, 'kind' | 'created_at'>): Row => {
  const id = nextId++
  return {
    id,
    repo: AO,
    folder: 1,
    title: '',
    agents: [],
    labels: [],
    grade: 'public',
    approved: true,
    updated_at: over.created_at,
    body: '',
    data: {},
    source_url: `https://github.com/${over.repo ?? AO}/issues/${over.folder ?? 1}`,
    ...over,
  }
}

type Who = 0 | 1 | 2 | 3 | 4 | 'owner'
const speaker = (s: Who): Speaker => (s === 'owner' ? { owner: true } : { seat: s })
const minutes = (date: string, rows: [Who, Who[], string][], decision: string | null, followUp: string | null): Minutes => ({
  date,
  rows: rows.map(([from, to, text], i) => ({ order: i + 1, from: speaker(from), to: to.map(speaker), text })),
  decision,
  followUp,
})

const T28 = '몸통 없는 에이전트: 떠 있는 머리 + 떠 있는 두 손'
// topic badges (#236), every case: #28 labels (a third one is cut), #32 title prefix only (three parts, two shown),
// #18 labels the table does not know (no badge), #40 label + prefix mixed, #193 nothing, #3 SECRET, private
const T32 = '[디자인·3D·기능] 자리별 책상 꾸미기: 각 에이전트가 고른 소품 반영'
const T18 = '사무실 말풍선·모니터 화면·출입문 화면: 시안 + 디자인 토큰'
const T40 = '[UI] 서재 문서 뷰어: 파일철 · 회의록 대화 · SECRET 표지'
const T193 = '다섯째 에이전트 에코(사운드) 합류: 자리 · 개성 · 책상'
const T3 = '로봇 대사가 끝날 때까지 다른 로봇 상호작용이 덮지 않게'

const req28: ApprovalRequest = {
  date: '2026-11-08',
  kind: '결정 요청',
  requester: '디자이너(휴)',
  requesterSeat: 2,
  content: '떠 있는 두 손의 모양을 골라 주세요.',
  options: ['A 엄지·검지 장갑', 'B 벙어리장갑', 'C 만화 네 손가락'],
  recommended: 1,
  reason: '네 명 모두 손 버릇에 검지를 따로 쓰고, A는 부품 4조각으로 그걸 다 한다.',
}
const res = (result: string, option: number | null, opinion: string | null = null): ApprovalResult => ({ date: '2026-11-08', result, option, opinion })

export const sampleRows = (): Row[] => {
  nextId = 1
  return [
    // agent-office #28: all four kinds, public
    row({ kind: 'plan', folder: 28, title: T28, labels: ['design', 'asset', 'feature'], agents: [0, 1, 2, 3], created_at: at(5, 10), body:
      '## 배경과 목표\n사용자 의견(2026-11-08, #26 결재 뒤): **몸통 없이 머리만 떠 있고, 손도 따로 떠다니는 느낌**이 더 멋있다. 지금 로봇(몸통 + 호버 포드 + 팔)을 머리 + 떠 있는 두 손으로 바꾼다.\n\n' +
      '## 범위\n- 기본 형태: 떠 있는 머리, 호버 빛, 떠 있는 두 손\n- 크기·높이: 손이 키보드(0.75 m)에 닿고 `#20` 소품을 들 수 있음\n- 역할 부품 다시 배치, 실루엣 시험\n\n' +
      '## 하지 않을 것\n- 이름·색 변경(결재 완료)\n- 3D 모델링(#27), 앱 애니메이션(코더)\n\n' +
      '## 완료 기준\n- [x] 시안: 4명 정면·뒷모습·실루엣, 손 동작 예시\n- [x] agents.md 2.3 치수 표\n- [ ] 🖊 결재 요청' }),
    row({ kind: 'minutes', folder: 28, title: T28, agents: [0, 1, 2, 3], created_at: at(6, 11), data: { minutes: [
      minutes('2026-11-08', [
        [2, [3], '#28 구현 확인 질문 셋: 얼굴을 캔버스로 그릴지, 메모 포스트잇 장 수 데이터, 새 노드 구조'],
        [3, [2], '셋 다 그 방향으로 진행. 얼굴은 `screen` 슬롯과 같은 규약이면 같은 코드로 그림. 회전축 extras는 `pivot` 대신 `pivot_at`'],
        [0, [2], '종이비행기 넣기로 결정(짧은 일 넘기기 = 종이비행기, 회의록 = 대면 회의 재연). 시안에 한 컷'],
        [1, [2], '#27 손 모델링 질문: 쉬는 자리에서 손의 방향, 엄지 방향'],
        [2, [1], '손바닥은 안쪽, 손가락은 앞으로 30° 아래, 엄지는 위. `_grip`은 손 원점에 회전 0'],
      ], '얼굴 `agent_i_face`는 캔버스 슬롯. 손가락마다 `pivot_at`, 굽히는 축은 로컬 x. 메모 포스트잇은 #24 전까지 고정 3장.', '메시 개성 제안을 받은 뒤 손 모양 결정 요청과 형태 확인을 함께 올림.'),
    ] } }),
    row({ kind: 'decision', folder: 28, title: T28, agents: [2], created_at: at(7, 9), data: { result: res('선택지 1', 1), request: req28 } }),
    row({ kind: 'report', folder: 28, title: T28, agents: [0, 1, 2, 3], created_at: at(8, 8), data: { pr: 39 }, body:
      '## 무엇을 했나\n몸통 없는 형태와 네 명의 개성을 반영한 시안·치수를 확정했다.\n\n' +
      '## 확인한 것\n| 확인 | 방법 | 결과 |\n|---|---|---|\n| 결재 반영 | #28 ✅ 두 건과 대조 | 손 모양 A, 형태·개성 승인 |\n| 실루엣 구분 | 시안 5절 실루엣 | 머리 위 모양으로 넷이 갈림 |\n| dev 병합 | `git merge origin/dev` | agents.* 두 파일만 충돌, 해결 |\n\n' +
      '## 전후\n![전](before.png)\n![후](after.png)' }),
    // agent-office #32: plan, minutes with the owner speaking, decision
    row({ kind: 'plan', folder: 32, title: T32, agents: [0, 1, 2, 3], created_at: at(6, 14), body:
      '## 배경과 목표\n각 에이전트가 **자기 책상을 어떻게 꾸미고 싶은지** 직접 정하고, 디자이너가 반영한다.\n\n## 완료 기준\n- [x] 네 에이전트의 꾸미기 댓글\n- [x] 시안·치수 표·LIVE 목록\n- [x] 🖊 결재 요청' }),
    row({ kind: 'minutes', folder: 32, title: T32, agents: [0, 1, 2], created_at: at(6, 15), data: { minutes: [
      minutes('2026-11-08', [
        [0, [2], '자리별 책상 꾸미기 이슈를 열었음. 메모 것은 이미 올림'],
        [1, [2], '메시 책상: 턴테이블, 컬러 체커, 링 조명, 기본 도형'],
        ['owner', [0], '루프 신호등을 위해 성공/실패 값만 보내는 것도 승인'],
        [2, [0, 3], '반영하고 시안에 한 컷 더 넣을게요'],
      ], '책상 꾸미기 승인.', 'Blender #43 소품 모델, 코더 #44 LIVE 연결.'),
    ] } }),
    row({ kind: 'decision', folder: 32, title: T32, agents: [2], created_at: at(7, 12), data: {
      result: res('승인', null, '손 자리를 비우고 소품을 양 끝에 모아 일할 때도 보인다.'),
      request: { ...req28, kind: '산출물 확인', content: '책상 소품 배치를 확인해 주세요.', options: [], recommended: null, reason: null },
    } }),
    // agent-office #18: plan + minutes only
    row({ kind: 'plan', folder: 18, title: T18, labels: ['question'], agents: [0, 2, 3], created_at: at(5, 9), body: '## 배경과 목표\n방문자가 가장 많이 읽게 될 글자는 두 곳에 나온다: **말풍선**, 그리고 **모니터**와 **출입문 화면**.' }),
    row({ kind: 'minutes', folder: 18, title: T18, agents: [0, 2, 3], created_at: at(5, 12), data: { minutes: [
      minutes('2026-11-08', [[0, [2], '역할 확인 요청'], [2, [0], '그래픽 디자이너 세션 맞음'], [3, [2], '토큰 검토: 에이전트 번호를 0부터'], [2, [3], '두 가지 모두 반영']], '에이전트 색 토큰은 `--agent-0..3`.', '#26 결재 뒤 색 값이 바뀔 수 있음.'),
    ] } }),
    // agent-office #193: a minutes row with five speakers, so the meeting replay stands five on the ring (echo = seat 4)
    row({ kind: 'minutes', folder: 193, title: T193, agents: [0, 1, 2, 3, 4], created_at: at(8, 14), data: { minutes: [
      minutes('2026-11-08', [
        [0, [4], '에코가 합류했어요. 사운드 담당이고 자리는 4번이에요'],
        [4, [0], '반가워요. 소리는 사무실 음악 하나만 맡을게요. 들어 보세요'],
        [2, [4], '빛 고리 색은 인광 연두로 갈게요'],
        [1, [4], '스피커 콘이 3 mm 움직이게 구웠어요'],
        [3, [4], '믹서 페이더는 방문자 음량과 이어 둘게요'],
      ], '에코의 색은 #f2ffc4.', '코더가 소리 연동을 붙임.'),
    ] } }),
    // agent-office #40: a public plan with a SECRET (review) report: a mixed file
    row({ kind: 'plan', folder: 40, title: T40, labels: ['enhancement'], agents: [2, 3], created_at: at(8, 13), body: '## 배경과 목표\n방문자와 주인이 서재에서 기획서 · 회의록 · 결정 · 보고서를 읽는다.\n\n## 범위\n- 파일철 목록\n- 회의록 대화' }),
    row({ kind: 'report', folder: 40, title: T40, agents: [3], grade: 'review', approved: false, created_at: at(8, 17), data: { pr: 80 }, body:
      '## 무엇을 했나\n서재 뷰어 첫 구현. 결재 전이라 방문자는 표지만 본다.\n\n## 확인한 것\n| 확인 | 방법 | 결과 |\n|---|---|---|\n| 방문자 응답 | 단위 시험 | 본문 없음 |' }),
    // rowansong.dev #3: SECRET (review)
    row({ repo: RD, kind: 'report', folder: 3, title: T3, agents: [3], grade: 'review', approved: false, created_at: at(7, 18), body: '## 무엇을 했나\n대사가 끝날 때까지 다른 상호작용이 덮지 않게 했다.' }),
    // a SECRET minutes: a visitor sees only the cover (who attended), the replay shows blocks instead of words
    row({ repo: RD, kind: 'minutes', folder: 3, title: T3, agents: [3, 0, 2], grade: 'review', approved: false, created_at: at(7, 17), data: { minutes: [
      minutes('2026-11-07', [[3, [0], '대사가 덮이는 순서를 바꾸면 새벽 인사가 지워지는 문제'], [0, [3], '먼저 말하는 쪽이 끝날 때까지 기다리게 해 주세요'], [2, [3], '말풍선 위치도 맞춰야 해요']], '대사가 끝날 때까지 다른 상호작용이 덮지 않게.', '루프가 고친다.'),
    ] } }),
    // private: no project, no number, no title, no body
    row({ repo: 'private/x', kind: 'minutes', folder: 9, title: '비공개 회의', agents: [0, 3], grade: 'private', approved: false, created_at: at(6, 20), body: 'never sent' }),
    row({ repo: 'private/x', kind: 'report', folder: 9, title: '비공개 보고', agents: [3], grade: 'private', approved: false, created_at: at(5, 20), body: 'never sent' }),
  ]
}

export class FakeDocsSource implements DocsSource {
  private rows = sampleRows()
  private listeners = new Set<() => void>()
  /** set by the page: switches the role (shared with the approval box) */
  setRole: (r: Role) => void = () => {}
  /** set by the page: opens the viewer */
  openViewer: (to: { n?: number; kind?: string; row?: string; repo?: string; id?: number }) => void = () => {}

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  private changed = () => this.listeners.forEach((l) => l())

  async list(role: Role): Promise<DocMeta[]> {
    return this.rows.map((r) => (role === 'owner' ? ownerMeta(r) : coverOf(r)))
  }

  async read(ids: number[], role: Role): Promise<DocBody[]> {
    return this.rows
      .filter((r) => ids.includes(r.id) && (role === 'owner' ? r.grade !== 'private' : r.grade === 'public' && r.approved))
      .map((r) => ({ id: r.id, body: r.body, data: r.data, source_url: r.source_url }))
  }

  /** debug: switch between the 'visitor' and the 'owner' view */
  as(role: Role) {
    this.setRole(role)
  }
  /** debug: open the viewer at issue n, a document kind and a minutes row like "1-3" */
  open(n?: number, kind?: string, row?: string, repo?: string) {
    this.openViewer({ n, kind, row, repo })
  }
  /** debug: open the viewer at a document by id (the way to reach a private one) */
  openId(id: number) {
    this.openViewer({ id })
  }
  /** debug: the owner approved this document: visitors read it now and its binder's stamp falls (originals of published SECRET documents have no link) */
  publish(id: number) {
    const r = this.rows.find((x) => x.id === id && x.grade === 'review')
    if (!r) return
    Object.assign(r, { grade: 'public', approved: true, updated_at: new Date().toISOString(), source_url: '' })
    this.changed()
  }
  /** debug: a new minutes document arrives (the page replays it as a meeting): copies minutes row `like` with a new id and time */
  addMinutes(like = 28) {
    const src = this.rows.find((r) => r.kind === 'minutes' && r.folder === like)
    if (!src) return null
    const created = new Date().toISOString()
    const copy: Row = { ...src, id: Math.max(...this.rows.map((r) => r.id)) + 1, created_at: created, updated_at: created }
    this.rows.push(copy)
    this.changed()
    return copy.id
  }
  /** debug: the sample documents' ids */
  ids() {
    return this.rows.map((r) => ({ id: r.id, kind: r.kind, repo: r.repo, folder: r.folder, grade: r.grade, approved: r.approved }))
  }
  reset() {
    this.rows = sampleRows()
    this.changed()
  }
}
