// #402: the first screen fetches the Galmuri11 subsets only (scripts/font-subset.mjs). Every character written in src/ is in the subset (a new UI word
// with a character outside it would fetch the whole font: run node scripts/font-subset.mjs), and the subset and the whole font of a weight never
// overlap (so `document.fonts.load()` of the family fetches the subset alone) and together cover everything.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const css = readFileSync(join(__dirname, 'fonts.css'), 'utf8')

/** the faces in fonts.css: weight, file, and the code points' ranges */
const faces = [...css.matchAll(/@font-face \{[^}]*?font-weight: (\d+);[^}]*?src: url\('([^']+)'\)[^}]*?unicode-range: ([^;]+);/g)].map((m) => ({
  weight: Number(m[1]),
  file: m[2],
  ranges: m[3].split(',').map((r) => {
    const [a, b] = r.trim().slice(2).split('-')
    return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number]
  }),
}))
const has = (ranges: [number, number][], c: number) => ranges.some(([a, b]) => c >= a && c <= b)

function sourceChars(): Set<number> {
  const out = new Set<number>()
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|css|json)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/\.fixture\.ts$/.test(f) && f !== 'fonts.css') for (const ch of readFileSync(p, 'utf8')) out.add(ch.codePointAt(0)!)
    }
  }
  walk(SRC)
  return out
}

describe('the Galmuri11 subset (#402)', () => {
  it('four faces: a subset and the whole font for each of the two weights', () => {
    expect(faces.map((f) => [f.weight, f.file.includes('subset')])).toEqual([[400, true], [700, true], [400, false], [700, false]])
    for (const f of faces.filter((x) => x.file.includes('subset'))) expect(statSync(join(__dirname, f.file)).size, f.file).toBeLessThan(60 * 1024)
  })

  it('every character written in src/ is in the subset (else: node scripts/font-subset.mjs)', () => {
    const subset = faces[0].ranges
    const missing = [...sourceChars()].filter((c) => c >= 0x20 && c !== 0xfeff && !has(subset, c)).map((c) => String.fromCodePoint(c))
    expect(missing).toEqual([])
  })

  it('a weight\'s subset and whole font never overlap and cover everything; KS X 1001 Hangul is in the subset', () => {
    for (const w of [400, 700]) {
      const [sub, whole] = [faces.find((f) => f.weight === w && f.file.includes('subset'))!, faces.find((f) => f.weight === w && !f.file.includes('subset'))!]
      const all = [...sub.ranges, ...whole.ranges].sort((x, y) => x[0] - y[0])
      expect(all[0][0]).toBe(0)
      for (let k = 1; k < all.length; k++) expect(all[k][0], `after U+${all[k - 1][1].toString(16)}`).toBe(all[k - 1][1] + 1)
      expect(all[all.length - 1][1]).toBe(0x10ffff)
    }
    // a few common syllables and the ones the office writes
    for (const ch of '가각간갇갈한글정리쉬는중') expect(has(faces[0].ranges, ch.codePointAt(0)!), ch).toBe(true)
  })
})
