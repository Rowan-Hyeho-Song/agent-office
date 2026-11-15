// #402: the first screen fetches the Galmuri11 subsets only (scripts/font-subset.mjs). Every character written in src/ is in the subset (a new UI word
// with a character outside it would fetch the whole font: run node scripts/font-subset.mjs), and the subset and the whole font of a weight never
// overlap (so `document.fonts.load()` of the family fetches the subset alone) and together cover everything.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
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

/** the name IDs in a woff2's name table (WOFF2: a table directory, then one brotli stream of the tables in order; the name table is never transformed) */
function woff2NameIds(buf: Buffer): number[] {
  let p = 48
  const numTables = buf.readUInt16BE(12)
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[p++]
      v = v * 128 + (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new Error('bad UIntBase128')
  }
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep']
  const tables: { tag: string; length: number }[] = []
  for (let k = 0; k < numTables; k++) {
    const flags = buf[p++]
    const tag = (flags & 0x3f) === 0x3f ? buf.toString('latin1', p, (p += 4)) : KNOWN[flags & 0x3f] ?? `#${flags & 0x3f}`
    const version = (flags >> 6) & 3
    const orig = base128()
    // glyf / loca are transformed unless version 3, hmtx when version 1: those carry a transformLength
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    const length = transformed ? base128() : orig
    tables.push({ tag, length })
  }
  const data = brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)))
  let off = 0
  for (const t of tables) {
    if (t.tag === 'name') {
      const count = data.readUInt16BE(off + 2)
      return Array.from({ length: count }, (_, i) => data.readUInt16BE(off + 6 + i * 12 + 6))
    }
    off += t.length
  }
  return []
}

describe('the subsets keep the font\'s copyright and licence (OFL 1.1 §2, #402)', () => {
  it('fonts.css names the font, its author and the licence; each subset keeps name IDs 0 · 13 · 14', () => {
    expect(css).toMatch(/Galmuri11 © 2019–2025 Lee Minseo, SIL Open Font License 1\.1, https:\/\/openfontlicense\.org — subset/)
    for (const f of faces.filter((x) => x.file.includes('subset'))) {
      const ids = woff2NameIds(readFileSync(join(__dirname, f.file)))
      for (const id of [0, 13, 14]) expect(ids, `${f.file} name ID ${id}`).toContain(id)
    }
  })
})
