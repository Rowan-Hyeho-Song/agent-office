// What the office hook sends instead of the work itself: a seat number and an activity kind. Runs on the PC
// inside the Claude Code hook (office-hook.mjs); the command text, arguments, paths and tool input never
// leave it (plan.md 5.1, #1 decision log). No dependencies, so the hook runs with plain `node`.

/** @typedef {'edit'|'read'|'test'|'build'|'install'|'git'|'run'|'other'|'delegate'|'think'|'private'} Activity */

/** tool name → activity; shell tools are classified by their command */
const TOOLS = {
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  LS: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  Agent: 'delegate',
  Task: 'delegate',
}

const PM = '(?:pnpm|npm|yarn|bun)'
/**
 * Shell command kinds, checked in this order on each part of the command (a && b, a; b, a | b): the first
 * part that is not just setup (cd, env vars, echo) decides. Override or extend in the hook config ("bash").
 * @type {[Activity, RegExp[]][]}
 */
export const BASH_RULES = [
  ['test', [
    new RegExp(`^${PM}\\s+(run\\s+)?test\\b`),
    /^(npx\s+|pnpm\s+(exec|dlx)\s+)?(vitest|jest|mocha|ava|playwright\s+test)\b/,
    /^(python\d?\s+-m\s+)?pytest\b/,
    /^(go|cargo|dotnet|deno|bun)\s+test\b/,
    /^node\s+--test\b/,
  ]],
  ['build', [
    new RegExp(`^${PM}\\s+(run\\s+)?(build|typecheck|lint|check)\\b`),
    /^(npx\s+|pnpm\s+(exec|dlx)\s+)?(tsc|vite\s+build|eslint|biome)\b/,
    /^(go|cargo|dotnet)\s+build\b/,
    /^(make|cmake|gradle|gradlew|mvn|msbuild)\b/,
    // the 3D agent's bakes: Blender in the background, or the build-*.sh scripts that run it (#44 turntable)
    // (the path may hold spaces, quoted or not: "C:/Program Files/Blender/blender.exe" -b f.blend)
    /^"?([^"]*[\\/])?blender(\.exe)?"?(\s|$)/i,
    /^(bash\s+|sh\s+)?(\S*[\\/])?build-[\w-]+\.sh\b/,
  ]],
  ['install', [
    new RegExp(`^${PM}\\s+(install|i|ci|add|remove|rm|update|up|upgrade)\\b`),
    new RegExp(`^${PM}$`),
    /^(pip\d?|uv|poetry)\s+(install|add|sync|pip)\b/,
    /^(cargo\s+add|brew\s+install|apt(-get)?\s+install|winget\s+install|choco\s+install)\b/,
  ]],
  ['git', [/^git\b/, /^gh\b/]],
  ['run', [
    new RegExp(`^${PM}\\s+(run\\s+)?(dev|start|preview|serve)\\b`),
    /^(node|deno|bun|python\d?|ts-node|tsx)\b/,
    /^(npx\s+|pnpm\s+(exec|dlx)\s+)?vite\b/,
    /^(bash|sh|pwsh|powershell)\s+\S+\.(sh|ps1)\b/,
    /^\.{0,2}\/\S+\.(sh|ps1)\b/,
  ]],
]

/** setup-only parts that don't say what the command is about */
const SETUP = /^(cd|pushd|popd|set|export|echo|printf|true|sleep|mkdir|ls|pwd|cat|head|tail|which|where)\b/

/** strip the wrappers that don't change the kind: env assignments, timeout N, time, sudo */
function core(part) {
  let s = part.trim()
  for (;;) {
    const next = s
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(timeout\s+\d+[smh]?|time|sudo|command|exec)\s+/, '')
      .replace(/^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=\s*("[^"]*"|'[^']*'|\S*)\s*;?\s*/, '')
    if (next === s) return s
    s = next
  }
}

/**
 * @param {string} command
 * @param {[Activity, RegExp[]][]} [rules]
 * @returns {Activity}
 */
export function classifyCommand(command, rules = BASH_RULES) {
  const parts = String(command ?? '')
    .split(/\r?\n|&&|\|\||;|\|/)
    .map(core)
    .filter((p) => p && !p.startsWith('#'))
  for (const part of parts) {
    if (SETUP.test(part)) continue
    for (const [kind, res] of rules) if (res.some((re) => re.test(part))) return kind
    return 'other'
  }
  return 'other'
}

/**
 * @param {string} tool  hook tool_name
 * @param {unknown} input  hook tool_input (only a shell command is looked at, and only here)
 * @param {[Activity, RegExp[]][]} [rules]
 * @returns {Activity}
 */
export function classifyTool(tool, input, rules) {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = input && typeof input === 'object' ? /** @type {{command?: string}} */ (input).command : ''
    return classifyCommand(command ?? '', rules)
  }
  return Object.hasOwn(TOOLS, tool) ? TOOLS[tool] : 'other'
}

/**
 * Default title → seat (#26: 0 기획 메모, 1 3D 메시, 2 디자인 휴, 3 코더 루프). Role words and agent names only;
 * common English words like design / 3d / planning are left out (#34). Override with "seats" in hook.json.
 */
export const DEFAULT_SEATS = [
  { seat: 0, title: '기획|메모|\\bmemo\\b' },
  { seat: 1, title: 'blender|메시|\\bmesh\\b' },
  { seat: 2, title: '디자이너|디자인|\\bhue\\b' },
  { seat: 3, title: '코더|루프|\\bloop\\b' },
]

/**
 * Folders whose sessions may report to the office (#34). The hook runs for every session on the PC (it lives
 * in the user settings), so anything outside these, such as work projects, sends nothing at all.
 * Patterns are matched against the whole cwd, with `/` separators and case ignored: `*` = any characters
 * within one folder name, `**` = any number of folders. A match also covers everything below it.
 * The defaults match these two repositories and their worktrees wherever they are checked out.
 */
export const DEFAULT_PROJECTS = ['**/agent-office*', '**/rowansong.dev*']

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * @param {string|undefined} cwd  hook input cwd
 * @param {string[]} [projects]
 * @returns {boolean}
 */
export function insideProjects(cwd, projects = DEFAULT_PROJECTS) {
  const path = norm(cwd)
  if (!path) return false
  return projects.some((pattern) => {
    const source = norm(pattern)
      .split(/(\*\*\/?|\*)/)
      .map((part) => (part === '*' ? '[^/]*' : part.startsWith('**') ? '(?:.*/)?' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
      .join('')
    return new RegExp(`^${source}(?:/|$)`).test(path)
  })
}

/**
 * Which seat a session belongs to, from its title (/rename, or the name the editor gave it). First match wins.
 * @param {string|undefined} title
 * @param {{seat: number, title: string}[]} seats  title = regular expression source, case-insensitive
 * @returns {number|null}
 */
export function seatFor(title, seats) {
  if (!title) return null
  for (const s of seats) if (new RegExp(s.title, 'i').test(title)) return s.seat
  return null
}

/**
 * Did a test / build pass (#44, the coder's signal light)? Claude Code calls PostToolUse when a shell command
 * succeeded and PostToolUseFailure when it exited non-zero, so the event name alone is the answer: the hook
 * never reads tool_response or error (the output). Only test / build commands report; everything else, and
 * every other tool, says nothing.
 * @param {{ hook_event_name?: string, tool_name?: string, tool_input?: unknown }} input
 * @param {[Activity, RegExp[]][]} [rules]
 * @returns {{ kind: 'result', activity: 'test' | 'build', ok: boolean } | null}
 */
export function resultFor(input, rules) {
  if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') return null
  const activity = classifyTool(input.tool_name, input.tool_input, rules)
  if (activity !== 'test' && activity !== 'build') return null
  return { kind: 'result', activity, ok: input.hook_event_name === 'PostToolUse' }
}

/**
 * Hook event → signal kind (null = nothing to send). Subagent tool calls arrive with the parent's session and
 * count as the parent's activity.
 * @param {{hook_event_name?: string, tool_name?: string, tool_input?: unknown}} input
 * @param {[Activity, RegExp[]][]} [rules]
 * @returns {{kind: 'start'|'activity'|'stop'|'end', activity?: Activity} | null}
 */
export function signalFor(input, rules) {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return { kind: 'start' }
    case 'UserPromptSubmit':
      return { kind: 'activity', activity: 'think' }
    case 'PreToolUse':
      return { kind: 'activity', activity: classifyTool(input.tool_name ?? '', input.tool_input, rules) }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return resultFor(input, rules)
    case 'Stop':
      return { kind: 'stop' }
    case 'SessionEnd':
      return { kind: 'end' }
    default:
      return null
  }
}
