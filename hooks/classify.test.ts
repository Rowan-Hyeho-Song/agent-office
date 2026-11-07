import { describe, expect, it } from 'vitest'
import { BASH_RULES, classifyCommand, classifyTool, seatFor, signalFor } from './classify.mjs'

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
