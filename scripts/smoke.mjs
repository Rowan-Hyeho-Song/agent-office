// First-render smoke check (#94): the office must draw on the plain page, not only under ?debug=1.
// Opens each page in Chrome, waits, and fails if there is no WebGL canvas, any page error, or a console error
// (React's render-loop warnings arrive as console errors). A missing favicon is not an error.
//
// It runs every page under both loopback names (localhost and 127.0.0.1), and with its own server twice: once
// with the Supabase public env of .env.local (the live status / approvals / docs path, realtime included) and
// once without it (the local fake path). The env case is skipped, with a note, when there is no such env.
//
//   pnpm smoke                     starts its own Vite dev servers (both env cases)
//   pnpm smoke -- --url <origin>   checks a server that is already running (whatever env it was started with)
//
// Needs Chrome installed (playwright-core drives the system browser; no browser download).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PAGES = [
  { name: '일반 페이지', url: '/' },
  { name: '디버그', url: '/?debug=1' },
]
/** the two names of this machine: on Windows `localhost` is ::1 first, so a page can reach a different server */
const HOSTS = ['localhost', '127.0.0.1']
const WAIT_MS = 8000
/** console errors that are not the page's fault */
const IGNORE = [/favicon/i]
const SUPABASE_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

/** the same origin under another loopback name (null when it is not a loopback origin) */
const withHost = (origin, host) => {
  const u = new URL(origin)
  if (!HOSTS.includes(u.hostname) && u.hostname !== '[::1]') return null
  u.hostname = host
  return u.origin
}

/** a Vite dev server on 127.0.0.1 (both names reach it), with or without the Supabase env */
async function startServer(withSupabase) {
  const { createServer, loadEnv } = await import('vite')
  const env = loadEnv('development', process.cwd(), 'VITE_')
  if (withSupabase && !SUPABASE_ENV.every((k) => env[k])) return null
  // no env: a fresh empty env dir, and nothing inherited from the shell either
  const emptyDir = withSupabase ? null : mkdtempSync(join(tmpdir(), 'smoke-env-'))
  const saved = Object.fromEntries(SUPABASE_ENV.map((k) => [k, process.env[k]]))
  if (!withSupabase) for (const k of SUPABASE_ENV) delete process.env[k]
  const server = await createServer({
    ...(emptyDir ? { envDir: emptyDir } : {}),
    server: { host: '127.0.0.1', port: 5198, strictPort: false },
    logLevel: 'error',
  })
  await server.listen()
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
  return {
    origin: server.resolvedUrls.local[0].replace(/\/$/, ''),
    close: async () => {
      await server.close()
      if (emptyDir) rmSync(emptyDir, { recursive: true, force: true })
    },
  }
}

const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0

async function check(label, origin) {
  for (const host of HOSTS) {
    const base = withHost(origin, host)
    if (!base) continue
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
      let canvases = 0
      try {
        await page.goto(base + pg.url)
        await page.waitForTimeout(WAIT_MS)
        canvases = await page.locator('canvas').count()
        if (!canvases) problems.unshift('canvas 없음 (3D가 그려지지 않음)')
      } catch (e) {
        problems.unshift(`열지 못함: ${e.message.split('\n')[0]}`)
      }
      // a 404 for the favicon shows up as a resource console error without a URL in its text: drop those
      const real = problems.filter((p) => !/^console: Failed to load resource: .*404/.test(p))
      console.log(`${real.length ? '✗' : '✓'} [${label}] ${pg.name} ${base}${pg.url}  canvas ${canvases}`)
      for (const p of real.slice(0, 8)) console.log(`    ${p.slice(0, 300)}`)
      if (real.length) failed++
      await ctx.close()
    }
  }
}

try {
  const url = arg('--url')
  if (url) await check('지정 서버', url.replace(/\/$/, ''))
  else
    for (const [label, withSupabase] of [
      ['Supabase env 있음', true],
      ['Supabase env 없음', false],
    ]) {
      const server = await startServer(withSupabase)
      if (!server) {
        console.log(`- [${label}] 건너뜀: .env.local 등에 ${SUPABASE_ENV.join(' / ')}가 없음`)
        continue
      }
      try {
        await check(label, server.origin)
      } finally {
        await server.close()
      }
    }
} finally {
  await browser.close()
}
console.log(failed ? `실패: ${failed}개 페이지` : '통과: 모든 페이지가 그려지고 오류 없음')
process.exit(failed ? 1 : 0)
