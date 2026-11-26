import { describe, expect, it } from 'vitest'
import { keyOf } from './task.mjs'

// #710 (C안): a private project's folder is listed only in the local hook.json (`privateProjects`, never in the repo). Its sessions say only that they
// work ("비공개 작업 중") and mark it `hidden`, so the server leaves a contentless timelapse point; no results, planes or tasks. A folder outside every
// list says nothing (no `outside`), and a server from before #710 (400 to `hidden`) still gets the plain private activity.
describe('office-hook: private projects (#710)', () => {
  it('a listed folder sends activity private + hidden, never a task or a result; an unlisted one sends nothing; an old server gets it again without hidden', async () => {
    const { spawn } = await import('node:child_process')
    const { createServer } = await import('node:http')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const bodies: Record<string, unknown>[] = []
    let old = false
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const b = JSON.parse(body) as Record<string, unknown>
        bodies.push(b)
        if (old && 'hidden' in b) res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad signal"}')
        else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const home = mkdtempSync(join(tmpdir(), 'office-hook-private-'))
    const listed = mkdtempSync(join(tmpdir(), 'example-private-'))
    const unlisted = mkdtempSync(join(tmpdir(), 'elsewhere-'))
    writeFileSync(join(home, 'hook.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/events`, token: 't', projects: ['**/agent-office*'], privateProjects: ['**/example-private-*'] }))
    // a task declared for the private folder is never sent
    writeFileSync(join(home, 'tasks.json'), JSON.stringify({ [keyOf(listed)]: { repo: 'agent-office', issue: 170 } }))
    const run = (input: Record<string, unknown>) =>
      new Promise<void>((done) => {
        const env = { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_SEAT: '3' }
        delete env.AGENT_OFFICE_CONFIG
        delete env.AGENT_OFFICE_TASK
        const p = spawn(process.execPath, [resolve('hooks/office-hook.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('exit', () => done())
        p.stdin.end(JSON.stringify({ session_id: `s-${bodies.length}-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, ...input }))
      })
    try {
      await run({ cwd: listed })
      // a test command's outcome (PostToolUse on Bash) is not sent from a private project
      await run({ cwd: listed, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' }, tool_response: { exit_code: 0 } })
      await run({ cwd: unlisted })
      old = true
      await run({ cwd: listed })
    } finally {
      server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(listed, { recursive: true, force: true })
      rmSync(unlisted, { recursive: true, force: true })
    }
    expect(bodies).toEqual([
      { seat: 3, kind: 'activity', activity: 'private', hidden: true },
      // (the test outcome and the unlisted folder: nothing)
      // the old server: 400 to hidden, then the plain private activity
      { seat: 3, kind: 'activity', activity: 'private', hidden: true },
      { seat: 3, kind: 'activity', activity: 'private' },
    ])
  }, 30_000)
})
