// #535: a turn that ends with background work still running is not a rest: the Stop hook says what it waits for (background / bg_test /
// bg_build / bg_delegate), from Claude Code's Stop input `background_tasks`; the wait ends when the session says anything again, or after
// backgroundMinutes (hook.json) by itself. The command is only classified on the PC: it is never kept or sent.
import { describe, expect, it } from 'vitest'
import { BACKGROUND_MINUTES, backgroundFor, backgroundOver, resultFor, signalFor } from './classify.mjs'

const shell = (command: string, status = 'running') => ({ id: 't1', type: 'shell', status, description: 'x', command })

describe('backgroundFor (#535)', () => {
  it('a test, a build, anything else, a subagent; a mix is just "background"', () => {
    expect(backgroundFor({ background_tasks: [shell('pnpm test')] })).toBe('bg_test')
    expect(backgroundFor({ background_tasks: [shell('cd /c/Repo/x && npx vitest run src/office')] })).toBe('bg_test')
    expect(backgroundFor({ background_tasks: [shell('pnpm build')] })).toBe('bg_build')
    expect(backgroundFor({ background_tasks: [shell('npx vite build')] })).toBe('bg_build')
    expect(backgroundFor({ background_tasks: [shell('node scripts/measure.mjs 3')] })).toBe('background')
    expect(backgroundFor({ background_tasks: [{ id: 'a', type: 'subagent', status: 'running', agent_type: 'general-purpose' }] })).toBe('bg_delegate')
    expect(backgroundFor({ background_tasks: [{ id: 'w', type: 'workflow', status: 'running', name: 'x' }] })).toBe('background')
    expect(backgroundFor({ background_tasks: [shell('pnpm test'), { id: 'a', type: 'subagent', status: 'running' }] })).toBe('background')
    expect(backgroundFor({ background_tasks: [shell('pnpm test'), shell('npx vitest run x')] })).toBe('bg_test')
  })
  it('nothing left: none, finished ones, a dev server or a watcher, a monitor', () => {
    expect(backgroundFor({})).toBeNull()
    expect(backgroundFor({ background_tasks: [] })).toBeNull()
    expect(backgroundFor({ background_tasks: 'x' })).toBeNull()
    for (const status of ['completed', 'failed', 'killed', 'Stopped']) expect(backgroundFor({ background_tasks: [shell('pnpm test', status)] })).toBeNull()
    for (const cmd of ['cd /c/Repo/x && npx vite --port 5392 --strictPort --host 127.0.0.1 > log 2>&1', 'pnpm dev', 'npm run preview', 'npx serve dist', 'node build.mjs --watch'])
      expect(backgroundFor({ background_tasks: [shell(cmd)] }), cmd).toBeNull()
    expect(backgroundFor({ background_tasks: [{ id: 'm', type: 'monitor', status: 'running' }] })).toBeNull()
    // a server beside a test: the test is what it waits for
    expect(backgroundFor({ background_tasks: [shell('pnpm dev'), shell('pnpm test')] })).toBe('bg_test')
  })
  it('Stop: the wait instead of a stop while work is left, the stop otherwise', () => {
    expect(signalFor({ hook_event_name: 'Stop', background_tasks: [shell('pnpm test')] })).toEqual({ kind: 'activity', activity: 'bg_test' })
    expect(signalFor({ hook_event_name: 'Stop', background_tasks: [] })).toEqual({ kind: 'stop' })
    expect(signalFor({ hook_event_name: 'Stop' })).toEqual({ kind: 'stop' })
  })
  it("a test started in the background reports at its launch: no outcome then (the light stays yellow until the session says more)", () => {
    const post = (run_in_background?: boolean) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test', run_in_background } })
    expect(resultFor(post(true))).toBeNull()
    expect(signalFor(post(true))).toBeNull()
    expect(resultFor(post())).toEqual({ kind: 'result', activity: 'test', ok: true })
    expect(resultFor(post(false))).toEqual({ kind: 'result', activity: 'test', ok: true })
  })

  it('the wait is over only when nothing newer was sent and the time is up', () => {
    const at = 1_000_000
    const saved = { seat: 3, kind: 'activity', activity: 'bg_build', sentAt: at }
    expect(backgroundOver(saved, at, at + BACKGROUND_MINUTES * 60000)).toBe(true)
    expect(backgroundOver(saved, at, at + BACKGROUND_MINUTES * 60000 - 1)).toBe(false)
    expect(backgroundOver({ ...saved, sentAt: at + 5 }, at, at + 3_600_000)).toBe(false)
    expect(backgroundOver({ ...saved, activity: 'edit' }, at, at + 3_600_000)).toBe(false)
    expect(backgroundOver({ ...saved, kind: 'stop' }, at, at + 3_600_000)).toBe(false)
    expect(backgroundOver(null, at, at + 3_600_000)).toBe(false)
    expect(backgroundOver(saved, at, at + 60_000, 1)).toBe(true)
  })
})

describe('office-hook: a Stop with background work (#535)', () => {
  it('says what it waits for, keeps and sends no command; ends the wait by itself after backgroundMinutes, but not once the session woke', async () => {
    const { spawn } = await import('node:child_process')
    const { createServer } = await import('node:http')
    const { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const bodies: { session: string; body: Record<string, unknown> }[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        bodies.push({ session: '', body: JSON.parse(body) })
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const home = mkdtempSync(join(tmpdir(), 'office-hook-bg-'))
    // 0.02 min = 1.2 s: the wait ends by itself that soon here
    writeFileSync(join(home, 'hook.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/events`, token: 't', backgroundMinutes: 0.02, keepaliveSeconds: 0 }))
    const SECRET = 'pnpm test -- --token=SECRET_abc123 C:/Users/someone/private'
    const run = (session: string, input: Record<string, unknown>) =>
      new Promise<void>((done) => {
        const env = { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_SEAT: '3' }
        delete env.AGENT_OFFICE_CONFIG
        delete env.AGENT_OFFICE_TASK
        const p = spawn(process.execPath, [resolve('hooks/office-hook.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('exit', () => done())
        p.stdin.end(JSON.stringify({ session_id: session, cwd: resolve('.'), ...input }))
      })
    try {
      // a: the turn ends with a test running in the background, the session never wakes
      await run('a', { hook_event_name: 'Stop', background_tasks: [shell(SECRET)] })
      // b: the same, but the session wakes (a tool) before the time is up
      await run('b', { hook_event_name: 'Stop', background_tasks: [{ id: 'x', type: 'subagent', status: 'running' }] })
      await run('b', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} })
      // a's wait ends by itself after 1.2 s (a detached process: under a loaded run it may take longer to start): wait until its stop has come
      // (at most 20 s), then 1.5 s more, so a stop of b (which woke, and must send none) would have come too
      const until = Date.now() + 20_000
      while (!bodies.some((b) => b.body.kind === 'stop') && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 1500))
      const files = readdirSync(join(home, 'sessions')).map((f) => readFileSync(join(home, 'sessions', f), 'utf8'))
      // nothing of the command is kept on the PC
      for (const f of files) {
        expect(f).not.toContain('SECRET')
        expect(f).not.toContain('pnpm')
        expect(f).not.toContain('someone')
      }
    } finally {
      server.close()
      rmSync(home, { recursive: true, force: true })
    }
    const sent = bodies.map((b) => b.body)
    // nothing of the command is sent
    expect(JSON.stringify(sent)).not.toContain('SECRET')
    expect(sent.slice(0, 3)).toEqual([
      { seat: 3, kind: 'activity', activity: 'bg_test' },
      { seat: 3, kind: 'activity', activity: 'bg_delegate' },
      { seat: 3, kind: 'activity', activity: 'edit' },
    ])
    // a's wait ended by itself; b's did not (it woke)
    expect(sent.slice(3)).toEqual([{ seat: 3, kind: 'stop' }])
  }, 30_000)
})

describe('office-hook: a server from before #535 (400 to the background waits)', () => {
  it('the wait is said again once as the stop it was before; nothing else is sent twice', async () => {
    const { spawn } = await import('node:child_process')
    const { createServer } = await import('node:http')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const bodies: Record<string, unknown>[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const b = JSON.parse(body)
        bodies.push(b)
        // the old allow list: no background activities
        const old = typeof b.activity === 'string' && (b.activity === 'background' || b.activity.startsWith('bg_'))
        res.writeHead(old ? 400 : 200, { 'content-type': 'application/json' }).end(old ? '{"error":"bad"}' : '{"ok":true}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const home = mkdtempSync(join(tmpdir(), 'office-hook-bg-old-'))
    writeFileSync(join(home, 'hook.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/events`, token: 't', keepaliveSeconds: 0 }))
    const run = (input: Record<string, unknown>) =>
      new Promise<void>((done) => {
        const env = { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_SEAT: '3' }
        delete env.AGENT_OFFICE_CONFIG
        delete env.AGENT_OFFICE_TASK
        const p = spawn(process.execPath, [resolve('hooks/office-hook.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('exit', () => done())
        p.stdin.end(JSON.stringify({ session_id: 'old', cwd: resolve('.'), ...input }))
      })
    try {
      await run({ hook_event_name: 'Stop', background_tasks: [shell('pnpm build')] })
      await run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} })
    } finally {
      server.close()
      rmSync(home, { recursive: true, force: true })
    }
    expect(bodies).toEqual([
      { seat: 3, kind: 'activity', activity: 'bg_build' },
      { seat: 3, kind: 'stop' },
      { seat: 3, kind: 'activity', activity: 'edit' },
    ])
  }, 30_000)
})
