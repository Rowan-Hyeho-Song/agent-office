// Automated accessibility check (#83): axe-core over the office's 2D UI in a real browser.
// The 3D canvas is out of scope (it has its own keyboard alternatives); the HUD, agent list, approval box and
// panels are checked, in the states a visitor and the owner actually see (the ?debug=1 fake approval source).
//
//   pnpm a11y                     starts its own Vite dev server
//   pnpm a11y -- --url <origin>   checks a server that is already running
//
// Prints the violations per state by impact; exits 1 if any is serious or critical.
// Needs Chrome installed (playwright-core drives the system browser; no browser download).

import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')
const FAIL_ON = ['serious', 'critical']
const IMPACTS = ['critical', 'serious', 'moderate', 'minor']
/** what axe skips: the WebGL canvas, and overlays that exist only under ?debug=1 */
const EXCLUDE = ['canvas', '.debug-panel', '.nav-label']

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

let server = null
let origin = arg('--url')
if (!origin) {
  const { createServer } = await import('vite')
  server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
  await server.listen()
  origin = server.resolvedUrls.local[0]
}
origin = origin.replace(/\/$/, '')

/** each state: where to go and what to do there before checking */
const STATES = [
  { name: '방문자 · 패널 닫힘', url: '/?debug=1' },
  { name: '방문자 · 결재함', url: '/?debug=1&approvals=visitor' },
  { name: '주인 · 목록', url: '/?debug=1&approvals=owner' },
  { name: '주인 · 한 건(표 포함)', url: '/?debug=1&approvals=owner', act: (p) => p.locator('.approval-item').nth(1).click() },
  {
    name: '주인 · 반려 의견 필수',
    url: '/?debug=1&approvals=owner',
    act: async (p) => {
      await p.locator('.approval-item').nth(1).click()
      await p.locator('.approval-option', { hasText: '반려' }).first().click()
    },
  },
  {
    name: '주인 · 결재 직후 도장',
    url: '/?debug=1&approvals=owner',
    act: async (p) => {
      await p.locator('.approval-item').first().click()
      await p.locator('.approval-option').first().click()
      await p.locator('.btn-primary').click()
      await p.waitForTimeout(700)
    },
  },
  // decided approvals (#222): the list, the owner's read-only detail, the visitor's cover
  { name: '주인 · 처리됨 목록', url: '/?debug=1&approvals=owner', act: (p) => p.getByRole('tab', { name: /처리됨/ }).click() },
  {
    name: '주인 · 처리된 결재 상세',
    url: '/?debug=1&approvals=owner',
    act: async (p) => {
      await p.getByRole('tab', { name: /처리됨/ }).click()
      await p.locator('.approval-item').first().click()
    },
  },
  { name: '방문자 · 처리된 결재 표지', url: '/?debug=1&approvals=visitor', act: (p) => p.locator('.secret-done button').first().click() },
  { name: '주인 · 목록 (390px)', url: '/?debug=1&approvals=owner', viewport: { width: 390, height: 844 } },
  // the timelapse (#82): the office replay with its bar, the 2D list, the phone's bar
  { name: '타임랩스 · 사무실', url: '/?debug=1&replay=all&t=2026-11-08T01:00:00Z', act: (p) => p.waitForSelector('.replay-slider') },
  { name: '타임랩스 · 목록', url: '/?debug=1&replay=all&t=2026-11-08T01:00:00Z', act: (p) => p.evaluate(() => window.__replay.setMode('list')) },
  { name: '타임랩스 · 휴대폰 막대', url: '/?debug=1&replay=all&t=2026-11-08T01:00:00Z', viewport: { width: 390, height: 844 }, act: async (p) => {
      // a phone opens the 2D list by default; "사무실에서 보기" brings the bar
      await p.getByText('▶ 사무실에서 보기').click()
      await p.waitForSelector('.replay-slider')
    } },
]

const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
const total = Object.fromEntries(IMPACTS.map((k) => [k, 0]))
try {
  for (const s of STATES) {
    const ctx = await browser.newContext({ viewport: s.viewport ?? { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(origin + s.url)
    await page.waitForSelector('.approval-launcher, .approval-box', { timeout: 30000 })
    await page.waitForTimeout(1500)
    if (s.act) {
      await s.act(page)
      await page.waitForTimeout(300)
    }
    await page.addScriptTag({ path: AXE })
    const violations = await page.evaluate(
      async (exclude) => (await window.axe.run({ exclude: exclude.map((e) => [e]) }, { resultTypes: ['violations'] })).violations,
      EXCLUDE,
    )
    const by = Object.fromEntries(IMPACTS.map((k) => [k, 0]))
    for (const v of violations) by[v.impact ?? 'minor'] += v.nodes.length
    for (const k of IMPACTS) total[k] += by[k]
    console.log(`\n${s.name}  ${IMPACTS.map((k) => `${k} ${by[k]}`).join(' · ')}`)
    for (const v of violations) {
      const bad = FAIL_ON.includes(v.impact)
      if (bad) failed++
      console.log(`  ${bad ? '✗' : '·'} [${v.impact}] ${v.id} × ${v.nodes.length}: ${v.help}`)
      for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  await server?.close()
}
console.log(`\n합계  ${IMPACTS.map((k) => `${k} ${total[k]}`).join(' · ')}`)
console.log(failed ? `실패: serious·critical 위반 ${failed}종` : '통과: serious·critical 위반 없음')
process.exit(failed ? 1 : 0)
