// The word filter of rowansong.dev's guestbook (src/lib/profanity.ts there), the same list and rules, for the office's notes (#4 12.3):
// shared by the note form (instant feedback) and /api/note (the gate that counts). Keep the two copies in step.
// A first line, not a complete list: the common Korean and English swear words and sexual terms, plus the
// usual ways of hiding them (digits or dots inside a word, letters spaced out one by one, leetspeak).
// Words that are also everyday Korean are left out or allow-listed: 보지 ("보지 마"), 자지 ("자지 마"),
// 꺼져 ("불이 꺼져"), 닥쳐 ("닥쳐오다"), 등신 ("등신대"), 성교 ("성교육"), 시발 in 시발점.

/** Korean words and jamo shorthands, matched inside a token */
const KO = [
  '씨발', '시발', '씨빨', '시빨', '씨팔', '시팔', '쓰발', '씨바', '씌발', '썅',
  'ㅅㅂ', 'ㅆㅂ', 'ㅅㅃ', 'ㅂㅅ', 'ㅄ', 'ㅈㄹ', 'ㅈㄴ', 'ㅗ',
  '병신', '븅신', '빙신', '병싄', '좆', '존나', '졸라', '존니', 'ㅈ같',
  '개새끼', '개새기', '개색기', '개색히', '개쌔끼', '개세끼', '새끼야', '호로자식',
  '지랄', '염병', '엠창', '느금', '니애미', '니미럴', '애미', '엿먹', '미친놈', '미친년', '미친새', '또라이',
  '쌍년', '쌍놈', '걸레년', '창녀', '창년',
  '섹스', '쎅스', '야동', '야설', '자위', '딸딸이', '강간', '후장', '젖탱', '빨통', '꼴리', '노콘', '펠라',
  '오르가즘', '포르노', '음란', '보짓', '보지털', '자짓', '자지털',
]
/** everyday words that contain a listed one; removed before matching */
const KO_ALLOW = ['시발점', '시발역', '시발택시']

/** English: anywhere inside a token */
const EN_ANYWHERE = ['fuck', 'motherf', 'nigger', 'asshole', 'bullshit', 'pussy', 'porno', 'hentai', 'dildo', 'blowjob', 'handjob', 'cumshot']
/** English: whole words only (short ones hide inside ordinary words: Sussex, cockpit, Dickens, shiitake) */
const EN_WORDS = new Set([
  'sex', 'sexx', 'dick', 'cock', 'cum', 'tits', 'boobs', 'rape', 'fag', 'faggot', 'xxx', 'nude', 'nudes', 'penis',
  'vagina', 'slut', 'bitch', 'cunt', 'shit', 'fck', 'fuk', 'porn', 'nigga', 'retard', 'bastard', 'whore', 'anal', 'wtf',
])

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' }

/**
 * Tokens split on whitespace, with runs of one-character tokens joined back together: "씨 발" and
 * "f u c k" are one word spelled out, while "다시 발견" stays two words (it would read 시발 if joined).
 */
function tokens(text: string, keep: RegExp): string[] {
  const out: string[] = []
  let run = ''
  for (const raw of text.split(/\s+/)) {
    const t = [...raw].filter((c) => keep.test(c)).join('')
    if (!t) continue
    if ([...t].length === 1) {
      run += t
      continue
    }
    if (run) out.push(run)
    run = ''
    out.push(t)
  }
  if (run) out.push(run)
  return out
}

/** true when the text has a word the guestbook doesn't take */
export function hasBadWord(text: string): boolean {
  const lower = text.normalize('NFC').toLowerCase()
  for (let t of tokens(lower, /[가-힣ㄱ-ㅎㅏ-ㅣ]/)) {
    for (const ok of KO_ALLOW) t = t.split(ok).join('')
    if (KO.some((w) => t.includes(w))) return true
  }
  const leet = [...lower].map((c) => LEET[c] ?? c).join('')
  for (const t of tokens(leet, /[a-z]/)) {
    if (EN_WORDS.has(t) || EN_ANYWHERE.some((w) => t.includes(w))) return true
  }
  return false
}

/** links invite spam; the guestbook is for a line of text */
export function hasLink(text: string): boolean {
  return /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|kr|io|xyz|me|co|ly|gg|site|link)\b/i.test(text)
}
