// First-render smoke check (#94): the office must draw on the plain page, not only under ?debug=1.
// Opens each page in Chrome, waits, and fails if there is no WebGL canvas, any page error, or a console error
// (React's render-loop warnings arrive as console errors). A missing favicon is not an error.
//
//   pnpm smoke                     starts its own Vite dev server
//   pnpm smoke -- --url <origin>   checks a server that is already running
//
// Needs Chrome installed (playwright-core drives the system browser; no browser download).

import { chromium } from 'playwright-core'

const PAGES = [
  { name: '일반 페이지', url: '/' },
  { name: '디버그', url: '/?debug=1' },
]
const WAIT_MS = 8000
/** console errors that are not the page's fault */
const IGNORE = [/favicon/i]

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

let server = null
let origin = arg('--url')
if (!origin) {
  const { createServer } = await import('vite')
  server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' })
  await server.listen()
  origin = server.resolvedUrls.local[0]
}
origin = origin.replace(/\/$/, '')

const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
try {
  for (const pg of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const problems = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const where = m.location()?.url ?? ''
      if (IGNORE.some((re) => re.test(m.text()) || re.test(where))) return
      problems.push(`console: ${m.text()}`)
    })
    page.on('response', (r) => {
      if (r.status() >= 400 && !IGNORE.some((re) => re.test(r.url()))) problems.push(`HTTP ${r.status()} ${r.url()}`)
    })
    await page.goto(origin + pg.url)
    await page.waitForTimeout(WAIT_MS)
    const canvases = await page.locator('canvas').count()
    if (!canvases) problems.unshift('canvas 없음 (3D가 그려지지 않음)')
    // a 404 for the favicon shows up as a resource console error without a URL in its text: drop those
    const real = problems.filter((p) => !/^console: Failed to load resource: .*404/.test(p))
    console.log(`${real.length ? '✗' : '✓'} ${pg.name} (${pg.url})  canvas ${canvases}`)
    for (const p of real.slice(0, 8)) console.log(`    ${p.slice(0, 300)}`)
    if (real.length) failed++
    await ctx.close()
  }
} finally {
  await browser.close()
  await server?.close()
}
console.log(failed ? `실패: ${failed}개 페이지` : '통과: 모든 페이지가 그려지고 오류 없음')
process.exit(failed ? 1 : 0)
