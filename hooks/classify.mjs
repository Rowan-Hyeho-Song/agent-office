// What the office hook sends instead of the work itself: a seat number and an activity kind. Runs on the PC
// inside the Claude Code hook (office-hook.mjs); the command text, arguments, paths and tool input never
// leave it (plan.md 5.1, #1 decision log). No dependencies, so the hook runs with plain `node`.

/** @typedef {'edit'|'read'|'test'|'build'|'install'|'git'|'run'|'other'|'delegate'|'think'} Activity */

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
    case 'Stop':
      return { kind: 'stop' }
    case 'SessionEnd':
      return { kind: 'end' }
    default:
      return null
  }
}
