import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs, no types
import { keyOf, parseTaskEnv, taskFor, validTask } from './task.mjs'

describe('validTask', () => {
  it('accepts an allowed repo and a positive integer (number or digits)', () => {
    expect(validTask('agent-office', 170)).toEqual({ repo: 'agent-office', issue: 170 })
    expect(validTask('Agent-Office', '170')).toEqual({ repo: 'agent-office', issue: 170 })
    expect(validTask('rowansong.dev', 1)).toEqual({ repo: 'rowansong.dev', issue: 1 })
  })
  it('rejects other repos and bad numbers', () => {
    expect(validTask('secret-company', 5)).toBeNull()
    expect(validTask('agent-office', 0)).toBeNull()
    expect(validTask('agent-office', -3)).toBeNull()
    expect(validTask('agent-office', 1.5)).toBeNull()
    expect(validTask('agent-office', 'abc')).toBeNull()
    expect(validTask('agent-office', '12; rm')).toBeNull()
    expect(validTask('agent-office', 1_000_001)).toBeNull()
    expect(validTask(undefined, 5)).toBeNull()
  })
  it('honours a configured allow-list', () => {
    expect(validTask('other', 5, ['other'])).toEqual({ repo: 'other', issue: 5 })
    expect(validTask('agent-office', 5, ['other'])).toBeNull()
  })
})

describe('parseTaskEnv', () => {
  it('reads repo#n', () => {
    expect(parseTaskEnv('agent-office#170')).toEqual({ repo: 'agent-office', issue: 170 })
    expect(parseTaskEnv('nope#1')).toBeNull()
    expect(parseTaskEnv('agent-office')).toBeNull()
    expect(parseTaskEnv(undefined)).toBeNull()
  })
})

describe('taskFor', () => {
  const tasks = { 'c:/repo/agent-office-task-coder': { repo: 'agent-office', issue: 182 } }
  it('finds the declaration at or above the session folder', () => {
    expect(taskFor('C:/Repo/agent-office-task-coder', undefined, tasks, '')).toEqual({ repo: 'agent-office', issue: 182 })
    expect(taskFor('C:/Repo/agent-office-task-coder/src/office', undefined, tasks, '')).toEqual({ repo: 'agent-office', issue: 182 })
  })
  it('another worktree has none', () => {
    expect(taskFor('C:/Repo/agent-office', undefined, tasks, '')).toBeNull()
    expect(taskFor('C:/Repo/agent-office-task-coder2', undefined, tasks, '')).toBeNull()
  })
  it('the env pin wins; a bad pin falls back to the file', () => {
    expect(taskFor('C:/Repo/x', undefined, tasks, 'rowansong.dev#12')).toEqual({ repo: 'rowansong.dev', issue: 12 })
    expect(taskFor('C:/Repo/agent-office-task-coder', undefined, tasks, 'bogus#1')).toEqual({ repo: 'agent-office', issue: 182 })
  })
  it('a stored repo that is no longer allowed is ignored', () => {
    expect(taskFor('C:/Repo/agent-office-task-coder', ['other'], tasks, '')).toBeNull()
  })
  it('keyOf normalizes slashes, case and the trailing slash', () => {
    expect(keyOf('C:/Repo/X/')).toBe('c:/repo/x')
  })
})

describe('office-hook sends repo / issue only when declared, inside the projects, for an allowed repo (#182)', () => {
  it('body carries the task, or not', async () => {
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
        bodies.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const home = mkdtempSync(join(tmpdir(), 'office-hook-task-'))
    writeFileSync(join(home, 'hook.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/events`, token: 't', outside: 'private', projects: ['**/agent-office*'] }))
    const inside = resolve('.')
    const run = (input: Record<string, unknown>, extraEnv: Record<string, string> = {}) =>
      new Promise<void>((done) => {
        const env = { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_SEAT: '3', ...extraEnv }
        delete env.AGENT_OFFICE_CONFIG
        delete env.AGENT_OFFICE_TASK
        Object.assign(env, extraEnv)
        const p = spawn(process.execPath, [resolve('hooks/office-hook.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('exit', () => done())
        p.stdin.end(JSON.stringify({ session_id: `s-${bodies.length}-${Math.random()}`, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, cwd: inside, ...input }))
      })
    const declare = (tasks: unknown) => writeFileSync(join(home, 'tasks.json'), JSON.stringify(tasks))
    try {
      // undeclared
      await run({})
      // declared for this folder
      declare({ [keyOf(inside)]: { repo: 'agent-office', issue: 170 } })
      await run({})
      // declared, but the repo is not allowed
      declare({ [keyOf(inside)]: { repo: 'secret-company', issue: 9 } })
      await run({})
      // declared, but the session is outside the project folders (private mode): never a task
      const outside = mkdtempSync(join(tmpdir(), 'elsewhere-'))
      declare({ [keyOf(outside)]: { repo: 'agent-office', issue: 170 } })
      await run({ cwd: outside })
      // the env pin
      await run({}, { AGENT_OFFICE_TASK: 'rowansong.dev#12' })
      rmSync(outside, { recursive: true, force: true })
    } finally {
      server.close()
      rmSync(home, { recursive: true, force: true })
    }
    expect(bodies).toEqual([
      { seat: 3, kind: 'activity', activity: 'edit' },
      { seat: 3, kind: 'activity', activity: 'edit', repo: 'agent-office', issue: 170 },
      { seat: 3, kind: 'activity', activity: 'edit' },
      { seat: 3, kind: 'activity', activity: 'private' },
      { seat: 3, kind: 'activity', activity: 'edit', repo: 'rowansong.dev', issue: 12 },
    ])
  }, 30_000)
})
