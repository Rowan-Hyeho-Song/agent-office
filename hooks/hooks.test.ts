import { describe, expect, it } from 'vitest'
import { formatApprovals } from './approvals.mjs'
import { resolveSeat } from './session.mjs'

describe('resolveSeat', () => {
  it('a pinned env wins over the title and saved seat', () => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, { seat: 1 }, '2')).toBe(2)
    expect(resolveSeat({}, {}, undefined, '0')).toBe(0)
  })
  it.each(['9', 'x', '-1', '4', ''])('ignores a pinned %j', (pin) => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, { seat: 1 }, pin)).toBe(3)
  })
  it('reads the title', () => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, {}, undefined)).toBe(3)
  })
  it('falls back to the saved seat without a title', () => {
    expect(resolveSeat({}, {}, { seat: 1 }, undefined)).toBe(1)
    expect(resolveSeat({ session_title: '그냥 이름' }, {}, { seat: 2 }, undefined)).toBe(2)
  })
  it('uses config seats when given', () => {
    expect(resolveSeat({ session_title: 'zzz' }, { seats: [{ seat: 2, title: 'zzz' }] }, {}, undefined)).toBe(2)
  })
  it('is null with nothing to go on', () => {
    expect(resolveSeat({}, {}, {}, undefined)).toBeNull()
    expect(resolveSeat({ session_title: '그냥 이름' }, {}, undefined, undefined)).toBeNull()
  })
})

describe('formatApprovals', () => {
  const item = {
    repo: 'Rowan-Hyeho-Song/agent-office',
    folder: 26,
    kind: '결정 요청',
    content: '이름 안을 골라 주세요',
    result: '선택지 1',
    chosen: 'A 사물 이름',
    opinion: '확정',
    result_url: 'https://github.com/Rowan-Hyeho-Song/agent-office/issues/26#issuecomment-1',
  }
  it('is empty for nothing', () => {
    expect(formatApprovals([])).toBe('')
    expect(formatApprovals(undefined as unknown as [])).toBe('')
  })
  it('lists repo name, #folder, result with the chosen text, opinion and url', () => {
    const t = formatApprovals([item])
    expect(t).toContain('agent-office #26')
    expect(t).not.toContain('Rowan-Hyeho-Song/agent-office #26')
    expect(t).toContain('선택지 1(A 사물 이름)')
    expect(t).toContain('의견: 확정')
    expect(t).toContain(item.result_url)
    expect(t).toContain('1건')
  })
  it('omits the parentheses, opinion and url when absent', () => {
    const t = formatApprovals([{ ...item, result: '승인', chosen: null, opinion: null, result_url: null }])
    expect(t).toContain('→ 결과: 승인')
    expect(t).not.toContain('의견')
  })
  it('cuts long content with …', () => {
    const t = formatApprovals([{ ...item, content: 'x'.repeat(500), opinion: 'y'.repeat(500) }])
    expect(t).toContain(`${'x'.repeat(119)}…`)
    expect(t).not.toContain('x'.repeat(120))
    expect(t).toContain(`${'y'.repeat(299)}…`)
  })
})
