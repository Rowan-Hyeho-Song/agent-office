#!/usr/bin/env node
// Claude Code hook → agent office (#1). Register it for SessionStart, UserPromptSubmit, PreToolUse, Stop and
// SessionEnd with "async": true (see hooks/README.md), so it never slows a tool call.
//
// Per event it sends at most { seat, kind, activity } to /api/events. The session's title picks the seat;
// the tool and command are reduced to an activity kind here on the PC (classify.mjs). It never sends the
// session id, paths, commands, prompts or tool input/output, and never fails the session: every error is
// swallowed and the exit code is always 0.
//
// Config: ~/.agent-office/hook.json (AGENT_OFFICE_HOME moves the whole folder, AGENT_OFFICE_CONFIG the file)
//   { "endpoint": "https://<office>/api/events", "token": "<OFFICE_HOOK_TOKEN>",
//     "seats": [{ "seat": 3, "title": "코더" }, …],   optional, defaults below
//     "keepaliveSeconds": 30,                          optional
//     "log": true }                                    optional: one line per event in ~/.agent-office/hook.log
//                                                    (event, seat, what was sent; no titles or content)
// AGENT_OFFICE_SEAT=0..3 in the environment pins the seat for sessions started from that shell.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { seatFor, signalFor } from './classify.mjs'

const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.agent-office')
const SESSIONS = join(HOME, 'sessions')
/** default title → seat (#26: 0 기획 메모, 1 3D 메시, 2 디자인 휴, 3 코더 루프) */
const SEATS = [
  { seat: 0, title: '기획|planning|메모|memo' },
  { seat: 1, title: 'blender|3d|메시|mesh' },
  { seat: 2, title: '디자이너|디자인|design|휴|hue' },
  { seat: 3, title: '코더|coder|루프|loop' },
]

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function readStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return JSON.parse(data || '{}')
}

/** session files older than three days are from sessions long gone */
function sweep() {
  const cutoff = Date.now() - 3 * 86400000
  for (const f of readdirSync(SESSIONS)) {
    const p = join(SESSIONS, f)
    if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true })
  }
}

async function main() {
  const config = readJson(process.env.AGENT_OFFICE_CONFIG ?? join(HOME, 'hook.json'))
  if (!config?.endpoint || !config?.token) return
  const input = await readStdin()
  const signal = signalFor(input)
  if (!signal || typeof input.session_id !== 'string') return

  mkdirSync(SESSIONS, { recursive: true })
  // the session id only names a local file; it is not sent
  const file = join(SESSIONS, `${input.session_id.replace(/[^\w-]/g, '')}.json`)
  const saved = readJson(file) ?? {}
  if (input.hook_event_name === 'SessionStart') sweep()

  // the title arrives on SessionStart and UserPromptSubmit (when the session has one); remember the seat
  const pinned = Number.parseInt(process.env.AGENT_OFFICE_SEAT ?? '', 10)
  const fromTitle = seatFor(input.session_title, config.seats ?? SEATS)
  const seat = Number.isInteger(pinned) && pinned >= 0 && pinned <= 3 ? pinned : (fromTitle ?? saved.seat ?? null)
  const log = (what) =>
    config.log &&
    appendFileSync(join(HOME, 'hook.log'), `${new Date().toISOString()} ${input.hook_event_name} titled=${Boolean(input.session_title)} seat=${seat} ${what}\n`)
  if (seat === null) return log('skip: no seat') // a session that isn't one of the four agents: say nothing

  // the same activity again within the keepalive window: nothing new to say
  const now = Date.now()
  const keepalive = (config.keepaliveSeconds ?? 30) * 1000
  const same = signal.kind === 'activity' && saved.kind === 'activity' && saved.activity === signal.activity
  if (same && saved.seat === seat && now - (saved.sentAt ?? 0) < keepalive) return log(`skip: same ${signal.activity}`)

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ seat, ...signal }),
    signal: AbortSignal.timeout(4000),
  })
  log(`${signal.kind}${signal.activity ? `/${signal.activity}` : ''} → ${res.status}`)
  if (res.ok) writeFileSync(file, JSON.stringify({ seat, kind: signal.kind, activity: signal.activity, sentAt: now }))
}

main()
  // AGENT_OFFICE_DEBUG=1 prints why nothing was sent (only to this terminal)
  .catch((e) => process.env.AGENT_OFFICE_DEBUG && console.error('office-hook:', e))
  .finally(() => process.exit(0))
