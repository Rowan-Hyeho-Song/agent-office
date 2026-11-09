import { describe, expect, it } from 'vitest'
import { readChoice } from './approve'
import { needsOpinion } from './approve'
import { answersFor, chosenOption, decidedCoverLabel, decidedLabel, decidedText, elapsedText, fmtDate, fmtStamp, kindOf, noteHint, oldestFirst, spokenDate, stampText } from './view'

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

describe('decided approval texts (#222)', () => {
  it('stampText: 승인 · 반려 · 안 N, document outcomes as they are', () => {
    expect([stampText('승인'), stampText('반려'), stampText('선택지 2'), stampText('고쳐서 공개'), stampText(null)]).toEqual(['승인', '반려', '안 2', '고쳐서 공개', ''])
  })
  it('chosenOption reads the column, else the result text', () => {
    expect(chosenOption({ option: 2, result: '선택지 2' })).toBe(2)
    expect(chosenOption({ option: null, result: '선택지 3' })).toBe(3)
    expect(chosenOption({ option: null, result: '반려' })).toBeNull()
  })
  const at = (h: number, m: number, d = 9) => new Date(2026, 10, d, h, m).toISOString()
  it('elapsedText', () => {
    expect(elapsedText(at(22, 36), at(23, 58))).toBe('걸린 시간 1시간 22분')
    expect(elapsedText(at(22, 0), at(23, 0))).toBe('걸린 시간 1시간')
    expect(elapsedText(at(22, 0), at(22, 7))).toBe('걸린 시간 7분')
    expect(elapsedText(at(22, 0), at(22, 0))).toBe('걸린 시간 1분 미만')
    expect(elapsedText(at(22, 0, 8), at(23, 0, 9))).toBe('걸린 시간 1일 1시간')
    expect(elapsedText(at(22, 0, 8), at(22, 0, 10))).toBe('걸린 시간 2일')
    expect(elapsedText(at(23, 0), at(22, 0))).toBeNull()
    expect(elapsedText(at(23, 0), null)).toBeNull()
    expect(elapsedText('nope', at(23, 0))).toBeNull()
  })
  it('fmtStamp and spokenDate use the viewer clock', () => {
    expect(fmtStamp(at(23, 58))).toBe('11-09 23:58')
    expect(fmtStamp(null)).toBe('')
    expect(spokenDate(at(23, 58))).toBe('11월 9일 23시 58분')
  })
  it('row labels: the owner hears the title, a visitor does not', () => {
    expect(decidedLabel('메모', '5인 책상 배치', '승인', at(23, 58))).toBe('메모 결재: 5인 책상 배치 — 승인, 11월 9일 23시 58분')
    expect(decidedLabel('메모', '배치', '선택지 2', at(23, 58))).toContain('— 안 2,')
    const v = decidedCoverLabel('메모', '반려', at(23, 58))
    expect(v).toBe('메모 결재 서류 — 반려, 11월 9일 23시 58분')
  })
})
