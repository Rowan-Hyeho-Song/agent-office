import { describe, expect, it } from 'vitest'
import { readChoice } from './approve'
import { needsOpinion } from './approve'
import { answersFor, decidedText, fmtDate, kindOf, noteHint, oldestFirst } from './view'

const base = { options: ['A', 'B'], recommended: 2 }

describe('answersFor', () => {
  it('every answer is one the server accepts', () => {
    for (const kind of ['결정 요청', '문서 공개', '산출물 확인']) {
      for (const a of answersFor({ kind, ...base })) expect(readChoice({ kind, options: base.options }, a.value)).not.toBeNull()
    }
  })
  it('결정 요청 lists the options, marks the recommended one and ends with 반려', () => {
    const a = answersFor({ kind: '결정 요청', ...base })
    expect(a.map((x) => x.value)).toEqual(['선택지 1', '선택지 2', '반려'])
    expect(a.map((x) => x.recommended)).toEqual([false, true, false])
    expect(a[2].reject).toBe(true)
  })
  it('문서 공개 and 산출물 확인', () => {
    expect(answersFor({ kind: '문서 공개', ...base }).map((x) => x.value)).toEqual(['공개', '고쳐서 공개', '계속 SECRET'])
    expect(answersFor({ kind: '산출물 확인', ...base }).map((x) => x.value)).toEqual(['승인', '반려'])
  })
})

describe('kindOf', () => {
  it('maps the kind text', () => {
    expect([kindOf('결정 요청'), kindOf('문서 공개'), kindOf('산출물 확인')]).toEqual(['decision', 'publish', 'review'])
  })
})

describe('noteHint', () => {
  it('the designed wording', () => {
    expect(noteHint('반려').hint).toBe('* 반려에는 이유가 필요해요')
    expect(noteHint('고쳐서 공개').hint).toBe('* 무엇을 고칠지 적어 주세요')
    expect(noteHint('계속 SECRET').hint).toBe('* 공개하지 않는 이유를 적어 주세요')
    expect(noteHint('공개').hint).toBe('(선택)')
    expect(noteHint(null).hint).toBe('(선택)')
  })
  it('requires an opinion exactly where the server does', () => {
    for (const r of ['승인', '반려', '공개', '고쳐서 공개', '계속 SECRET', '선택지 1', null]) expect(noteHint(r).required).toBe(r !== null && needsOpinion(r))
  })
  it('dims only 반려 and 계속 SECRET', () => {
    const dim = answersFor({ kind: '문서 공개', ...base }).map((x) => x.reject)
    expect(dim).toEqual([false, false, true])
    expect(answersFor({ kind: '산출물 확인', ...base }).map((x) => x.reject)).toEqual([false, true])
  })
})

describe('text', () => {
  it('the status sentence', () => {
    expect(decidedText({ title: '제목', repo: 'o/agent-office', folder: 28 }, '선택지 1')).toBe('결재했어요: 제목 — 선택지 1. agent-office #28에 댓글을 남겼어요.')
  })
  it('dates are MM.DD HH:mm', () => {
    expect(fmtDate(new Date(2026, 10, 8, 1, 5).toISOString())).toBe('11.08 01:05')
    expect(fmtDate('nope')).toBe('')
  })
  it('oldest first', () => {
    expect(oldestFirst([{ created_at: '2' }, { created_at: '1' }]).map((x) => x.created_at)).toEqual(['1', '2'])
  })
})
