import { describe, expect, it } from 'vitest'
import { handoffFor, BASH_RULES, DEFAULT_SEATS, classifyCommand, classifyTool, insideProjects, resultFor, seatFor, signalFor } from './classify.mjs'

const ACTIVITIES = ['edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think']

describe('classifyTool (non-shell tools)', () => {
  it.each([
    ['Edit', 'edit'],
    ['Write', 'edit'],
    ['MultiEdit', 'edit'],
    ['NotebookEdit', 'edit'],
    ['Read', 'read'],
    ['Grep', 'read'],
    ['Glob', 'read'],
    ['WebFetch', 'read'],
    ['WebSearch', 'read'],
    ['Agent', 'delegate'],
    ['Task', 'delegate'],
    ['mcp__x__y', 'other'],
    ['TodoWrite', 'other'],
    ['SendMessage', 'other'],
    ['', 'other'],
  ])('%s -> %s', (tool, expected) => {
    expect(classifyTool(tool, {})).toBe(expected)
  })

  it('Object.prototype names (constructor, toString) are not tools', () => {
    expect(classifyTool('constructor', {})).toBe('other')
    expect(classifyTool('toString', {})).toBe('other')
  })

  it('classifies Bash and PowerShell by command, tolerating missing input', () => {
    expect(classifyTool('Bash', { command: 'pnpm test' })).toBe('test')
    expect(classifyTool('PowerShell', { command: 'git status' })).toBe('git')
    expect(classifyTool('Bash', undefined)).toBe('other')
    expect(classifyTool('Bash', null)).toBe('other')
    expect(classifyTool('Bash', {})).toBe('other')
    expect(classifyTool('Bash', 'pnpm test')).toBe('other')
  })
})

describe('classifyCommand', () => {
  it.each([
    ['pnpm test', 'test'],
    ['pnpm run test -- --watch=false', 'test'],
    ['npx vitest run src', 'test'],
    ['pytest -q', 'test'],
    ['go test ./...', 'test'],
    ['cd /c/Repo/x && pnpm test', 'test'],
    ['pnpm build', 'build'],
    ['pnpm typecheck', 'build'],
    ['tsc -b', 'build'],
    ['cargo build --release', 'build'],
    ['make', 'build'],
    ['pnpm install', 'install'],
    ['pnpm add -D vitest', 'install'],
    ['npm ci', 'install'],
    ['pip install requests', 'install'],
    ['pnpm', 'install'],
    ['git status --short', 'git'],
    ['gh pr create --base dev', 'git'],
    ['pnpm dev --port 5181', 'run'],
    ['node scripts/x.mjs', 'run'],
    ['python app.py', 'run'],
    ['bash scripts/gh-image.sh a.png', 'run'],
    ['ls -la', 'other'],
    ['ls', 'other'],
    ['grep -rn foo src', 'other'],
    ['curl https://example.com', 'other'],
    ['', 'other'],
  ])('%j -> %s', (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected)
  })

  it('handles non-string input without throwing', () => {
    expect(classifyCommand(undefined as unknown as string)).toBe('other')
    expect(classifyCommand(null as unknown as string)).toBe('other')
  })

  it.each([
    ['FOO=1 pnpm test', 'test'],
    ['FOO="a b" BAR=2 pnpm test', 'test'],
    ['timeout 120 pnpm test', 'test'],
    ['sudo apt-get install foo', 'install'],
    ["$env:X='1'; pnpm build", 'build'],
    ['$env:X="a b"; pnpm build', 'build'],
  ])('ignores wrappers: %j -> %s', (cmd, expected) => {
    expect(classifyCommand(cmd)).toBe(expected)
  })

  it('lets the first non-setup part decide', () => {
    expect(classifyCommand('pnpm build && pnpm test')).toBe('build')
    expect(classifyCommand('echo hi; git log')).toBe('git')
    expect(classifyCommand('cd x\npnpm test')).toBe('test')
    expect(classifyCommand('# comment\npnpm test')).toBe('test')
    expect(classifyCommand('curl x | pnpm test')).toBe('other')
  })

  it('accepts custom rules', () => {
    const rules = [['run', [/^foo\b/]]] as never
    expect(classifyCommand('foo bar', rules)).toBe('run')
    expect(classifyCommand('pnpm test', rules)).toBe('other')
  })

  it('exports rules as [activity, regexps[]] pairs', () => {
    for (const [kind, res] of BASH_RULES) {
      expect(ACTIVITIES).toContain(kind)
      expect(res.length).toBeGreaterThan(0)
    }
  })

  it('privacy: result is always an activity name, never the command text (fuzz)', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const frags = ['pnpm', 'test', 'git', '&&', ';', '|', '||', '\n', 'FOO=1', "$env:X='1'", 'secret-token-abc', 'cd', ' ', '"', "'", '#', 'timeout 5', '/etc/passwd', '--flag', '한글', '\\']
    for (let i = 0; i < 500; i++) {
      let s = ''
      const n = Math.floor(rnd() * 12)
      for (let j = 0; j < n; j++) {
        s += rnd() < 0.7 ? frags[Math.floor(rnd() * frags.length)] : String.fromCharCode(Math.floor(rnd() * 0x500))
        if (rnd() < 0.5) s += ' '
      }
      const out = classifyCommand(s)
      expect(ACTIVITIES).toContain(out)
      expect(classifyTool('Bash', { command: s })).toBe(out)
    }
    expect(classifyCommand('curl https://x.test/?key=secret-token-abc')).toBe('other')
  })
})

describe('seatFor', () => {
  const seats = [
    { seat: 0, title: '기획|planning|메모|memo' },
    { seat: 1, title: 'blender|3d|메시|mesh' },
    { seat: 2, title: '디자이너|디자인|design|휴|hue' },
    { seat: 3, title: '코더|coder|루프|loop' },
  ]
  it.each([
    ['프로젝트 기획·설계 총괄', 0],
    ['프로젝트 Blender 작업', 1],
    ['프로젝트 그래픽 디자이너', 2],
    ['프로젝트 코더', 3],
    ['BLENDER', 1],
    ['Planning', 0],
    ['Lead CODER', 3],
    ['Graphic DESIGN', 2],
  ])('%j -> %i', (title, seat) => {
    expect(seatFor(title, seats)).toBe(seat)
  })

  it('returns null without a match or title', () => {
    expect(seatFor(undefined, seats)).toBeNull()
    expect(seatFor('', seats)).toBeNull()
    expect(seatFor('random', seats)).toBeNull()
    expect(seatFor('x', [])).toBeNull()
  })

  it('first match wins', () => {
    expect(seatFor('planning coder', seats)).toBe(0)
  })
})

describe('signalFor', () => {
  it('maps hook events', () => {
    expect(signalFor({ hook_event_name: 'SessionStart' })).toEqual({ kind: 'start' })
    expect(signalFor({ hook_event_name: 'UserPromptSubmit' })).toEqual({ kind: 'activity', activity: 'think' })
    expect(signalFor({ hook_event_name: 'Stop' })).toEqual({ kind: 'stop' })
    expect(signalFor({ hook_event_name: 'SessionEnd' })).toEqual({ kind: 'end' })
  })

  it('PreToolUse gives the activity per tool', () => {
    expect(signalFor({ hook_event_name: 'PreToolUse', tool_name: 'Edit' })).toEqual({ kind: 'activity', activity: 'edit' })
    expect(signalFor({ hook_event_name: 'PreToolUse', tool_name: 'Read' })).toEqual({ kind: 'activity', activity: 'read' })
    expect(signalFor({ hook_event_name: 'PreToolUse', tool_name: 'Agent' })).toEqual({ kind: 'activity', activity: 'delegate' })
    expect(signalFor({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } })).toEqual({ kind: 'activity', activity: 'test' })
    expect(signalFor({ hook_event_name: 'PreToolUse', tool_name: 'mcp__x__y' })).toEqual({ kind: 'activity', activity: 'other' })
    expect(signalFor({ hook_event_name: 'PreToolUse' })).toEqual({ kind: 'activity', activity: 'other' })
  })

  it('sends nothing for other events', () => {
    for (const e of ['PostToolUse', 'Notification', 'SubagentStop', 'PreCompact', '']) {
      expect(signalFor({ hook_event_name: e })).toBeNull()
    }
    expect(signalFor({})).toBeNull()
  })
})

/** a Windows path from a /-separated one (hook input on Windows uses backslashes) */
const win = (p: string) => p.replace(/\//g, '\\')

describe('insideProjects (#34)', () => {
  it.each([
    // the two repositories and their worktrees, wherever they are, any separator and case
    [win('C:/Repo/agent-office'), true],
    [win('C:/Repo/agent-office/src/office'), true],
    [win('C:/Repo/agent-office-17'), true],
    ['c:/repo/AGENT-OFFICE-1/hooks', true],
    [win('C:/Repo/rowansong.dev'), true],
    [win('C:/Repo/rowansong.dev/'), true],
    ['/home/me/code/rowansong.dev/api', true],
    ['/Users/me/rowansong.dev-worktree', true],
    // elsewhere: work projects, look-alikes, nothing
    [win('C:/Work/design-system'), false],
    [win('C:/Repo/my-agent-office'), false],
    [win('C:/Repo/agentoffice'), false],
    [win('C:/Users/me/Documents'), false],
    [win('C:/Repo/rowansong'), false],
    ['', false],
    [undefined, false],
  ])('%s → %s', (cwd, expected) => {
    expect(insideProjects(cwd as string | undefined)).toBe(expected)
  })

  it('custom patterns: absolute folders cover everything below them, * stays within one folder name', () => {
    const projects = ['D:/code/office', 'D:/sandbox/*/notes']
    expect(insideProjects(win('D:/code/office/a/b'), projects)).toBe(true)
    expect(insideProjects(win('D:/code/office-old'), projects)).toBe(false)
    expect(insideProjects(win('D:/sandbox/x/notes/today'), projects)).toBe(true)
    expect(insideProjects(win('D:/sandbox/x/y/notes'), projects)).toBe(false)
    expect(insideProjects(win('D:/code/office'), [])).toBe(false)
  })

  it('regex characters in a pattern are literal (the dot in rowansong.dev)', () => {
    expect(insideProjects(win('C:/Repo/rowansongXdev'))).toBe(false)
  })
})

describe('DEFAULT_SEATS (#34)', () => {
  it.each([
    ['프로젝트 기획·설계 총괄', 0],
    ['프로젝트 Blender 작업', 1],
    ['프로젝트 그래픽 디자이너', 2],
    ['프로젝트 코더', 3],
    ['메모 MEMO', 0],
    ['LOOP', 3],
    // common English words no longer pick a seat
    ['design review', null],
    ['3d printing notes', null],
    ['sprint planning', null],
    ['coder interview', null],
    ['loophole hunt', null],
  ])('%s → %s', (title, seat) => {
    expect(seatFor(title, DEFAULT_SEATS)).toBe(seat)
  })
})

describe('resultFor / signalFor results (#44)', () => {
  const ev = (hook_event_name: string, tool_name: string, command: string, extra: Record<string, unknown> = {}) => ({
    hook_event_name,
    tool_name,
    tool_input: { command },
    ...extra,
  })

  it('pnpm test → test result, ok from the event name', () => {
    expect(resultFor(ev('PostToolUse', 'Bash', 'pnpm test'))).toEqual({ kind: 'result', activity: 'test', ok: true })
    expect(resultFor(ev('PostToolUseFailure', 'Bash', 'pnpm test'))).toEqual({ kind: 'result', activity: 'test', ok: false })
    expect(signalFor(ev('PostToolUse', 'Bash', 'pnpm test'))).toEqual({ kind: 'result', activity: 'test', ok: true })
    expect(signalFor(ev('PostToolUseFailure', 'Bash', 'pnpm test'))).toEqual({ kind: 'result', activity: 'test', ok: false })
  })

  it.each([
    'pnpm build',
    'tsc -b',
    'blender --background --python x.py',
    'C:/Blender/blender.exe -b f.blend',
    './build-office.sh',
    'bash assets/blender/build-desk.sh',
  ])('%s → build', (command) => {
    expect(signalFor(ev('PostToolUse', 'Bash', command))).toEqual({ kind: 'result', activity: 'build', ok: true })
    expect(signalFor(ev('PostToolUseFailure', 'Bash', command))).toEqual({ kind: 'result', activity: 'build', ok: false })
  })

  // BUG: the blender rule's path part is S*, so a path with a space (Program Files) is not recognised
  it('a blender.exe path with a space is a build', () => {
    expect(resultFor(ev('PostToolUse', 'Bash', '"C:/Program Files/Blender/blender.exe" -b f.blend'))).toEqual({ kind: 'result', activity: 'build', ok: true })
    expect(resultFor(ev('PostToolUse', 'Bash', 'C:/Program Files/Blender/blender.exe -b f.blend'))).toEqual({ kind: 'result', activity: 'build', ok: true })
  })

  it('non test/build commands and other tools report nothing', () => {
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      for (const command of ['git status', 'ls', 'pnpm dev']) {
        expect(resultFor(ev(event, 'Bash', command))).toBeNull()
        expect(signalFor(ev(event, 'Bash', command))).toBeNull()
      }
      for (const tool of ['Edit', 'Read', 'Write', 'Agent']) {
        expect(resultFor(ev(event, tool, 'pnpm test'))).toBeNull()
        expect(signalFor(ev(event, tool, 'pnpm test'))).toBeNull()
      }
    }
  })

  it('PowerShell works the same', () => {
    expect(resultFor(ev('PostToolUse', 'PowerShell', 'pnpm test'))).toEqual({ kind: 'result', activity: 'test', ok: true })
    expect(resultFor(ev('PostToolUseFailure', 'PowerShell', 'pnpm build'))).toEqual({ kind: 'result', activity: 'build', ok: false })
    expect(resultFor(ev('PostToolUse', 'PowerShell', 'git status'))).toBeNull()
  })

  it('privacy: only kind, activity and ok leave, never tool_response / error', () => {
    const SECRET = 'sk-SECRET-12345'
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      const r = resultFor({
        hook_event_name: event,
        tool_name: 'Bash',
        tool_input: { command: `API_KEY=${SECRET} pnpm test`, description: SECRET },
        tool_response: { stdout: SECRET, stderr: SECRET },
        error: SECRET,
      } as never)
      expect(r).not.toBeNull()
      expect(Object.keys(r!)).toEqual(['kind', 'activity', 'ok'])
      expect(JSON.stringify(r)).not.toContain(SECRET)
      const s = signalFor({ hook_event_name: event, tool_name: 'Bash', tool_input: { command: `echo ${SECRET}; pnpm build` }, error: SECRET } as never)
      expect(Object.keys(s!)).toEqual(['kind', 'activity', 'ok'])
      expect(JSON.stringify(s)).not.toContain(SECRET)
    }
  })

  it('fuzz: 300 random commands only ever give the allowed shape', () => {
    const words = ['pnpm', 'test', 'build', 'blender', '-b', '&&', ';', '|', 'git', 'ls', 'tsc', 'cd', 'x.sh', 'bash', 'secret-xyz', '\n', 'vitest', 'run', '--', 'echo', 'make', '"', "'", '$(x)']
    let seed = 12345
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    for (let n = 0; n < 300; n++) {
      const command = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => words[Math.floor(rnd() * words.length)]).join(rnd() < 0.5 ? ' ' : '')
      for (const event of ['PostToolUse', 'PostToolUseFailure']) {
        for (const tool of ['Bash', 'PowerShell']) {
          const r = resultFor(ev(event, tool, command, { tool_response: 'secret-xyz', error: 'secret-xyz' }))
          if (r === null) continue
          expect(Object.keys(r)).toEqual(['kind', 'activity', 'ok'])
          expect(r.kind).toBe('result')
          expect(['test', 'build']).toContain(r.activity)
          expect(r.ok).toBe(event === 'PostToolUse')
          expect(JSON.stringify(r)).not.toContain('secret-xyz')
        }
      }
    }
  })
})

describe('handoffFor (#51 paper plane)', () => {
  const SECRET = 'SECRET-plane-c0ffee'
  const send = (to: unknown, message: unknown = `please look at ${SECRET}`) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'SendMessage',
    tool_input: { to, message, summary: SECRET },
  })

  it.each([
    ['프로젝트 기획·설계 총괄', 0],
    ['프로젝트 Blender 작업', 1],
    ['프로젝트 그래픽 디자이너', 2],
    ['프로젝트 코더', 3],
    ['프로젝트 코더 [f76c26]', 3],
  ])('to %s → seat %s, and nothing else', (to, seat) => {
    const s = handoffFor(send(to), DEFAULT_SEATS)
    expect(s).toEqual({ kind: 'handoff', to: seat })
    expect(Object.keys(s!)).toEqual(['kind', 'to'])
    expect(JSON.stringify(signalFor(send(to), undefined, DEFAULT_SEATS))).not.toContain(SECRET)
  })

  it('a receiver that is not one of the four agents → no plane (the call is just "other")', () => {
    expect(handoffFor(send('main'), DEFAULT_SEATS)).toBeNull()
    expect(handoffFor(send('abe9b8f2d273bfa8f'), DEFAULT_SEATS)).toBeNull()
    expect(signalFor(send('someone else'), undefined, DEFAULT_SEATS)).toEqual({ kind: 'activity', activity: 'other' })
  })

  it('other tools and odd inputs → no plane', () => {
    expect(handoffFor({ tool_name: 'Edit', tool_input: { to: '프로젝트 코더' } }, DEFAULT_SEATS)).toBeNull()
    expect(handoffFor({ tool_name: 'SendMessage', tool_input: { to: 3 } }, DEFAULT_SEATS)).toBeNull()
    expect(handoffFor({ tool_name: 'SendMessage' }, DEFAULT_SEATS)).toBeNull()
  })

  it('privacy fuzz: whatever the message says, only kind and a seat come out', () => {
    for (let i = 0; i < 200; i++) {
      const junk = `${SECRET} ${Math.random().toString(36)} ${'#'.repeat(i % 7)} ${i}`
      const s = signalFor(send('프로젝트 코더', junk), undefined, DEFAULT_SEATS)
      expect(JSON.stringify(s)).toBe('{"kind":"handoff","to":3}')
    }
  })
})
