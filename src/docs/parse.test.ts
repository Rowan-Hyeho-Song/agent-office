import { describe, expect, it } from 'vitest'
import { agentsIn, parseApprovalRequest, parseApprovalResult, parseMinutes, section, speakerFor, summarize } from './parse'
import type { Speaker } from './types'

const raw = import.meta.glob('./fixtures/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fx = (name: string): string => {
  const hit = Object.entries(raw).find(([p]) => p.endsWith(`/${name}.md`))
  if (!hit) throw new Error(`missing fixture ${name}`)
  return hit[1]
}

const S = (seat: 0 | 1 | 2 | 3): Speaker => ({ seat })
const OWNER: Speaker = { owner: true }

describe('speakerFor', () => {
  it.each<[string, Speaker]>([
    ['기획', S(0)],
    ['메모', S(0)],
    ['MEMO', S(0)],
    [' memo ', S(0)],
    ['Blender', S(1)],
    ['blender', S(1)],
    ['3D', S(1)],
    ['메시', S(1)],
    ['mesh', S(1)],
    ['디자이너', S(2)],
    ['디자인', S(2)],
    ['휴', S(2)],
    ['HUE', S(2)],
    ['코더', S(3)],
    ['루프', S(3)],
    ['Loop', S(3)],
    ['코더 세션', S(3)],
    ['사용자', OWNER],
    ['사람', OWNER],
    ['주인', OWNER],
    ['Rowan', OWNER],
    ['  Zed ', { name: 'Zed' }],
    ['', { name: '' }],
  ])('%j', (input, want) => {
    expect(speakerFor(input)).toEqual(want)
  })
})

describe('agentsIn', () => {
  it.each<[string, number[]]>([
    ['코더 세션(rowansong-dev-c2)', [3]],
    ['기획 세션, 코더 세션', [0, 3]],
    ['Blender · 디자이너', [1, 2]],
    ['3D와 HUE, loop', [1, 2, 3]],
    ['MEMO MESH HUE LOOP', [0, 1, 2, 3]],
    ['아무도 없음', []],
    ['LOOPING and 3Dx and HUEs', []],
    ['', []],
  ])('%j', (text, want) => {
    expect(agentsIn(text)).toEqual(want)
  })
})

describe('section', () => {
  const md = '# 제목\n\n## 배경과 목표\n\n첫 문단.\n\n둘째.\n\n### 소제목\n본문\n\n## 범위\n\n- a\n\n## 끝\nx'
  it('returns the text under a level-2 heading up to the next one', () => {
    expect(section(md, '배경과 목표')).toBe('첫 문단.\n\n둘째.\n\n### 소제목\n본문')
    expect(section(md, '범위')).toBe('- a')
    expect(section(md, '끝')).toBe('x')
  })
  it('is null when absent or only a deeper heading', () => {
    expect(section(md, '없음')).toBeNull()
    expect(section(md, '소제목')).toBeNull()
  })
})

describe('parseMinutes: fixtures', () => {
  it('returns [] without a minutes heading', () => {
    expect(parseMinutes('그냥 댓글')).toEqual([])
    expect(parseMinutes(fx('approval-6709822206'))).toEqual([])
  })

  it('minutes-6709447087: 3 rows, no decision/follow-up', () => {
    const [m, ...rest] = parseMinutes(fx('minutes-6709447087'))
    expect(rest).toEqual([])
    expect(m.date).toBe('2026-11-08')
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [1, S(0), [OWNER]],
      [2, S(1), [S(0)]],
      [3, S(0), [S(1)]],
    ])
    expect(m.rows[0].text).toBe('열린 질문 1·2·4에 추천안 제시 (아래)')
    expect(m.rows[1].text).toMatch(/^"에이전트 수·이름·역할·외형"이 정해져야/)
    expect(m.decision).toBeNull()
    expect(m.followUp).toBeNull()
  })

  it('minutes-6709447294: 4 rows, block decision (기획) with bullets, inline-less follow-up', () => {
    const [m] = parseMinutes(fx('minutes-6709447294'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [1, S(1), [S(0)]],
      [2, S(0), [S(1)]],
      [3, S(3), [S(1)]],
      [4, S(1), [S(0), S(3)]],
    ])
    expect(m.rows[2].text).toBe('빌드의 gltf-transform 평탄화 단계가 빈 노드(`nav_*`)를 지운다고 제보')
    expect(m.decision).toMatch(/^- \*\*b\. 로봇 기본 위치\*\*/)
    expect(m.decision).toMatch(/\*\*c-2\. 말풍선\*\*.*HTML 오버레이/)
    expect(m.decision).not.toContain('후속')
    expect(m.decision!.split('\n')).toHaveLength(3)
    expect(m.followUp).toMatch(/^확정된 화면 비율\(모니터 1\.7273/)
    expect(m.followUp).toMatch(/#20\(놀이 소품\)$/)
  })

  it('minutes-6709447685: 3 rows, neither decision nor follow-up (other bold lines are not them)', () => {
    const [m] = parseMinutes(fx('minutes-6709447685'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [1, S(3), [S(0)]],
      [2, S(0), [S(3)]],
      [3, S(0), [S(3)]],
    ])
    expect(m.decision).toBeNull()
    expect(m.followUp).toBeNull()
  })

  it('minutes-6709448190: no blank line after the heading is not this file; 5 rows, the second table is ignored', () => {
    const [m] = parseMinutes(fx('minutes-6709448190'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [1, S(0), [S(2)]],
      [2, S(2), [S(0)]],
      [3, S(0), [S(2)]],
      [4, S(0), [S(2)]],
      [5, S(0), [S(2)]],
    ])
    expect(m.rows[3].text).toBe('#16(PR #19)에서 확정된 화면 크기 전달 → 16:10 가정 대신 사용')
    expect(m.decision).toBeNull()
    expect(m.followUp).toBeNull()
  })

  it('minutes-6709623658: orders continue 6-8, bold-line decision with bullets, follow-up to the end', () => {
    const [m] = parseMinutes(fx('minutes-6709623658'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [6, S(0), [S(2)]],
      [7, S(2), [S(3)]],
      [8, S(2), [S(0)]],
    ])
    expect(m.rows[0].text).toMatch(/^문서 체계안\(#21 \/ PR #22\) 공유/)
    expect(m.decision).toMatch(/^- 시안·토큰·근거 문서를 PR #23으로 올렸다/)
    expect(m.decision!.split('\n')).toHaveLength(4)
    expect(m.followUp).toMatch(/^- 기획: “테스트 실행 중” 판정 규칙이 필요하다/)
    expect(m.followUp).toMatch(/--agent-N` 값과 탭 문구만 바꾼다\.$/)
    expect(m.followUp!.split('\n')).toHaveLength(4)
  })

  it('minutes-6709681788: no blank line after the heading, 5 rows, inline decision and follow-up', () => {
    expect(fx('minutes-6709681788').split('\n')[1]).toMatch(/^\| 순서/)
    const [m] = parseMinutes(fx('minutes-6709681788'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [1, S(0), [S(3)]],
      [2, S(3), [S(1)]],
      [3, S(1), [S(3)]],
      [4, S(3), [S(1)]],
      [5, S(3), [S(1)]],
    ])
    expect(m.decision).toMatch(/^지점 좌표는 glb\(Blender\), 간선은 앱의 `EDGES` 표/)
    expect(m.decision).toMatch(/vitest 5는 Node 22\.12\+ 필요, 로컬은 Node 20\)\.$/)
    expect(m.decision).not.toContain('후속')
    expect(m.followUp).toMatch(/^Blender #20 재베이크 → /)
    expect(m.followUp).toMatch(/반영합니다\.$/)
  })

  it('minutes-6709702793: orders 9-11, bullet decision, bullet follow-up', () => {
    const [m] = parseMinutes(fx('minutes-6709702793'))
    expect(m.rows.map((r) => [r.order, r.from, r.to])).toEqual([
      [9, S(0), [S(2)]],
      [10, S(3), [S(2)]],
      [11, S(2), [S(3)]],
    ])
    expect(m.rows[2].text).toBe('두 가지 모두 반영(커밋 c18d48c, c516d4f)')
    expect(m.decision).toMatch(/^- 활동 문구는 훅 activity와 1:1이다/)
    expect(m.decision!.split('\n')).toHaveLength(3)
    expect(m.followUp).toBe('- #26 결재 뒤 `--agent-N` 색 값이 바뀔 수 있다. 이름(번호)은 그대로다.')
  })
})

describe('parseMinutes: variants', () => {
  it('inline decision, several receivers, unknown names, escaped pipes, two blocks', () => {
    const md = [
      '앞 댓글',
      '### 🗂 에이전트 간 협의 기록 (2026-01-02)',
      '| 순서 | 보낸 쪽 → 받는 쪽 | 내용 |',
      '|---|---|---|',
      '| 1 | 기획 → 코더, Blender / 디자이너 | a \\| b |',
      '| 2 | Zed → 사용자 | `x` [링크](http://e.com) |',
      '',
      '**결정 (기획)**',
      '',
      '정했다.',
      '**후속**: 하나',
      '',
      '### 🗂 에이전트 간 협의 기록 (2026-01-03)',
      '',
      '| 순서 | 보낸 쪽 → 받는 쪽 | 내용 |',
      '|---|---|---|',
      '| 3 | 사람 → 메모·루프 | 끝 |',
    ].join('\n')
    const ms = parseMinutes(md)
    expect(ms).toHaveLength(2)
    expect(ms[0].date).toBe('2026-01-02')
    expect(ms[0].rows[0].to).toEqual([S(3), S(1), S(2)])
    expect(ms[0].rows[0].text).toBe('a | b')
    expect(ms[0].rows[1].from).toEqual({ name: 'Zed' })
    expect(ms[0].rows[1].to).toEqual([OWNER])
    expect(ms[0].rows[1].text).toBe('`x` [링크](http://e.com)')
    expect(ms[0].decision).toBe('정했다.')
    expect(ms[0].followUp).toBe('하나')
    expect(ms[1].rows).toEqual([{ order: 3, from: OWNER, to: [S(0), S(3)], text: '끝' }])
    expect(ms[1].decision).toBeNull()
  })

  it('heading without a date', () => {
    const [m] = parseMinutes('### 🗂 에이전트 간 협의 기록\n\n| 순서 | 보낸 쪽 → 받는 쪽 | 내용 |\n|---|---|---|\n| 1 | 기획 → 코더 | x |')
    expect(m.date).toBeNull()
    expect(m.rows).toHaveLength(1)
  })
})

describe('parseApprovalRequest: fixtures', () => {
  it('6709822206: names, 3 options, recommend 1', () => {
    const r = parseApprovalRequest(fx('approval-6709822206'))!
    expect(r.date).toBe('2026-11-08')
    expect(r.kind).toBe('결정 요청')
    expect(r.requester).toBe('디자인')
    expect(r.requesterSeat).toBe(2)
    expect(r.content).toMatch(/^에이전트 네 명\(기획·3D·디자인·코더\)의 이름 안 하나를 골라 주세요/)
    expect(r.options).toEqual([
      'A 사물 이름: 메모 MEMO · 메시 MESH · 휴 HUE · 루프 LOOP',
      'B 사람 이름: 피아 PIA · 레니 RENI · 디디 DIDI · 코디 CODY',
      'C 우리말: 짜임 · 빚음 · 그림 · 엮음 (이름표도 한글)',
    ])
    expect(r.recommended).toBe(1)
    expect(r.reason).toMatch(/^이름만 들어도 역할이 짐작됩니다/)
    expect(r.reason).not.toContain('agents-names')
  })

  it('6709822480: 2 options, recommend 1, table in content-less body', () => {
    const r = parseApprovalRequest(fx('approval-6709822480'))!
    expect(r.kind).toBe('결정 요청')
    expect(r.requesterSeat).toBe(2)
    expect(r.options).toEqual([
      '라벤더로 바꾸고 역할에 맞춰 배정',
      '지금 네 색(청록·분홍·호박·초록) 그대로, 배정만 역할에 맞춤(3D = 초록)',
    ])
    expect(r.recommended).toBe(1)
    expect(r.reason).toMatch(/^지금 네 색은 색약 시뮬레이션에서/)
  })

  it('6709822762: 산출물 확인, table in content, multi-line reason', () => {
    const r = parseApprovalRequest(fx('approval-6709822762'))!
    expect(r.kind).toBe('산출물 확인')
    expect(r.requester).toBe('디자인')
    expect(r.content).toMatch(/^에이전트 네 명의 외형 포인트/)
    expect(r.content).toContain('| 역할 | 머리 위 | 몸통 | 성격 |')
    expect(r.content).toMatch(/RB-10\.\.13`은 책상 방 로봇 RB-01의 10번대 형제라는 뜻입니다\.$/)
    expect(r.options).toEqual(['승인', '수정: 바꿀 역할과 부품을 의견에 적어 주세요'])
    expect(r.recommended).toBe(1)
    expect(r.reason).toMatch(/^네 가지 조건으로 골랐습니다\./)
    expect(r.reason!.split('\n')).toHaveLength(5)
  })

  it('6710165774: requester "코더(루프)" is seat 3, (추천) mid-line is removed', () => {
    const r = parseApprovalRequest(fx('approval-6710165774'))!
    expect(r.requester).toBe('코더(루프)')
    expect(r.requesterSeat).toBe(3)
    expect(r.content).toMatch(/^#1 코드는 PR #33으로 올렸습니다/)
    expect(r.content).toContain('- ③ 내 PC에 훅 등록')
    expect(r.options).toHaveLength(3)
    expect(r.options[0]).toMatch(/^①②는 사용자가 하고, ③은 코더가 함\. 토큰은 코더가 만들어/)
    expect(r.options[0]).not.toContain('추천')
    expect(r.options[2]).toBe('지금은 보류하고 배포는 #24(문서 수집)·#25(결재)와 함께 함')
    expect(r.recommended).toBe(1)
    expect(r.reason).toMatch(/^①②는 계정 권한이 있어야 하고/)
  })

  it('null for other comments; recommended null without a marker; unknown requester', () => {
    expect(parseApprovalRequest(fx('approval-6709870843'))).toBeNull()
    expect(parseApprovalRequest('아무 말')).toBeNull()
    const r = parseApprovalRequest('### 🖊 결재 요청\n**종류**: 문서 공개\n**요청**: 누군가\n**내용**: x\n\n**선택지**\n1. 공개\n2. 비공개\n')!
    expect(r.date).toBeNull()
    expect(r.requesterSeat).toBeNull()
    expect(r.recommended).toBeNull()
    expect(r.options).toEqual(['공개', '비공개'])
    expect(r.reason).toBeNull()
  })
})

describe('parseApprovalResult: fixtures', () => {
  it.each<[string, string, number | null, RegExp]>([
    ['approval-6709870843', '선택지 1', 1, /^이름 안 A\(메모 MEMO · 메시 MESH · 휴 HUE · 루프 LOOP\)로 확정\. 사용자 결정, 기획 세션이 대신 기록$/],
    ['approval-6709871153', '선택지 1', 1, /^3D 색을 라벤더 `#8f9bff`로 바꾸고 역할 순서로 자리 배정/],
    ['approval-6709871446', '승인', null, /^외형 포인트·이름표\(`RB-10\.\.13`\)·성격 한 줄 승인\./],
    ['approval-6710239720', '선택지 3', 3, /^보류\. Supabase 작업이 꽤 있어서 #24\(문서 수집\)·#25\(결재\)까지/],
  ])('%s', (name, result, option, opinion) => {
    const r = parseApprovalResult(fx(name))!
    expect(r.date).toBe('2026-11-08')
    expect(r.result).toBe(result)
    expect(r.option).toBe(option)
    expect(r.opinion).toMatch(opinion)
  })

  it('null for requests; opinion null when absent', () => {
    expect(parseApprovalResult(fx('approval-6709822206'))).toBeNull()
    expect(parseApprovalResult('### ✅ 결재 (2026-01-01)\n**결과**: 반려')).toEqual({ date: '2026-01-01', result: '반려', option: null, opinion: null })
  })
})

describe('summarize', () => {
  const plan = '<!-- 숨김 -->\n### 개요\n\n## 배경과 목표\n\n<!-- 안내 -->\n\n**문서**를 [링크](http://x.y)와 `code`로 *정리*한다.\n둘째 줄.\n\n다음 문단\n\n## 범위\n- x'
  it('plan: first paragraph of 배경과 목표, plain text', () => {
    expect(summarize('plan', plan)).toBe('문서를 링크와 code로 정리한다. 둘째 줄.')
  })
  it('plan: falls back to the first non-heading paragraph', () => {
    expect(summarize('plan', '# 제목\n\n본문 하나.\n\n둘.')).toBe('본문 하나.')
  })
  it('report: 무엇을, 왜', () => {
    expect(summarize('report', '## 무엇을, 왜\n\n이걸 했다. 이유는 이렇다.\n\n## 확인한 것\n표')).toBe('이걸 했다. 이유는 이렇다.')
  })
  it('minutes: decision, else first row', () => {
    expect(summarize('minutes', fx('minutes-6709681788'))).toMatch(/^지점 좌표는 glb\(Blender\), 간선은 앱의 EDGES 표\(코드\)가 맡습니다\./)
    expect(summarize('minutes', fx('minutes-6709447087'))).toBe('열린 질문 1·2·4에 추천안 제시 (아래)')
  })
  it('decision: approval opinion, else first paragraph', () => {
    expect(summarize('decision', fx('approval-6710239720'))).toMatch(/^보류\. Supabase 작업이/)
    expect(summarize('decision', '## 결정\n\n하나를 고른다.\n\n이유')).toBe('하나를 고른다.')
  })
  it('cuts on a word boundary with an ellipsis, within max', () => {
    const s = summarize('plan', '## 배경과 목표\n\n' + 'alpha beta gamma delta '.repeat(20), 40)
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toBe('alpha beta gamma delta alpha beta…')
    expect(summarize('plan', '## 배경과 목표\n\n짧다', 40)).toBe('짧다')
  })
  it('empty when nothing to summarize', () => {
    expect(summarize('plan', '')).toBe('')
  })
})
