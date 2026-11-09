import { describe, expect, it } from 'vitest'
import { formatApprovals } from './approvals.mjs'
import { resolveSeat } from './session.mjs'

describe('resolveSeat', () => {
  it('a pinned env wins over the title and saved seat', () => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, { seat: 1 }, '2')).toBe(2)
    expect(resolveSeat({}, {}, undefined, '0')).toBe(0)
  })
  it('a pinned 4 is the fifth seat (#193)', () => expect(resolveSeat({}, {}, undefined, '4')).toBe(4))
  it.each(['9', 'x', '-1', '5', ''])('ignores a pinned %j', (pin) => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, { seat: 1 }, pin)).toBe(3)
  })
  it('reads the title', () => {
    expect(resolveSeat({ session_title: '프로젝트 코더' }, {}, {}, undefined)).toBe(3)
  })
  it('falls back to the saved seat without a title', () => {
    expect(resolveSeat({}, {}, { seat: 1 }, undefined)).toBe(1)
    expect(resolveSeat({ session_title: '그냥 이름' }, {}, { seat: 2 }, undefined)).toBe(2)
  })
  it('uses config seats when given', () => {
    expect(resolveSeat({ session_title: 'zzz' }, { seats: [{ seat: 2, title: 'zzz' }] }, {}, undefined)).toBe(2)
  })
  it('is null with nothing to go on', () => {
    expect(resolveSeat({}, {}, {}, undefined)).toBeNull()
    expect(resolveSeat({ session_title: '그냥 이름' }, {}, undefined, undefined)).toBeNull()
  })
})

describe('formatApprovals', () => {
  const item = {
    repo: 'Rowan-Hyeho-Song/agent-office',
    folder: 26,
    kind: '결정 요청',
    content: '이름 안을 골라 주세요',
    result: '선택지 1',
    chosen: 'A 사물 이름',
    opinion: '확정',
    result_url: 'https://github.com/Rowan-Hyeho-Song/agent-office/issues/26#issuecomment-1',
  }
  it('is empty for nothing', () => {
    expect(formatApprovals([])).toBe('')
    expect(formatApprovals(undefined as unknown as [])).toBe('')
  })
  it('lists repo name, #folder, result with the chosen text, opinion and url', () => {
    const t = formatApprovals([item])
    expect(t).toContain('agent-office #26')
    expect(t).not.toContain('Rowan-Hyeho-Song/agent-office #26')
    expect(t).toContain('선택지 1(A 사물 이름)')
    expect(t).toContain('의견: 확정')
    expect(t).toContain(item.result_url)
    expect(t).toContain('1건')
  })
  it('omits the parentheses, opinion and url when absent', () => {
    const t = formatApprovals([{ ...item, result: '승인', chosen: null, opinion: null, result_url: null }])
    expect(t).toContain('→ 결과: 승인')
    expect(t).not.toContain('의견')
  })
  it('cuts long content with …', () => {
    const t = formatApprovals([{ ...item, content: 'x'.repeat(500), opinion: 'y'.repeat(500) }])
    expect(t).toContain(`${'x'.repeat(119)}…`)
    expect(t).not.toContain('x'.repeat(120))
    expect(t).toContain(`${'y'.repeat(299)}…`)
  })
})

describe('office-hook: the seat survives a failed send (#162)', () => {
  it('a title gives the seat once; the next events know it although /api/events answered 502', async () => {
    const { spawn } = await import('node:child_process')
    const { createServer } = await import('node:http')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, resolve } = await import('node:path')
    const seats: (number | null)[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seats.push((JSON.parse(body) as { seat: number | null }).seat)
        res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"store failed"}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const home = mkdtempSync(join(tmpdir(), 'office-hook-'))
    writeFileSync(join(home, 'hook.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${port}/api/events`, token: 't' }))
    const run = (input: Record<string, unknown>) =>
      new Promise<void>((done) => {
        const env = { ...process.env, AGENT_OFFICE_HOME: home }
        delete env.AGENT_OFFICE_SEAT
        delete env.AGENT_OFFICE_CONFIG
        const p = spawn(process.execPath, [resolve('hooks/office-hook.mjs')], { env, stdio: ['pipe', 'ignore', 'ignore'] })
        p.on('exit', () => done())
        p.stdin.end(JSON.stringify({ session_id: 's-1', cwd: resolve('.'), ...input }))
      })
    try {
      await run({ hook_event_name: 'UserPromptSubmit', session_title: '코더', prompt: 'x' })
      await run({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} })
      await run({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} })
    } finally {
      server.close()
      rmSync(home, { recursive: true, force: true })
    }
    // every event was sent (all failed with 502), and the two without a title still had the coder's seat
    expect(seats).toEqual([3, 3, 3])
  }, 20_000)
})
