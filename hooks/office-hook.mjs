#!/usr/bin/env node
// Claude Code hook → agent office (#1). Register it for SessionStart, UserPromptSubmit, PreToolUse, Stop,
// SessionEnd, and (#44) PostToolUse / PostToolUseFailure on Bash|PowerShell, all with "async": true (see
// hooks/README.md), so it never slows a tool call.
//
// Per event it sends at most { seat, kind, activity } to /api/events, plus ok (true / false) after a test or
// build command (#44). The session's title picks the seat; the tool and command are reduced to an activity
// kind here on the PC (classify.mjs). It never sends the session id, paths, commands, prompts or tool
// input/output, and never fails the session: every error is swallowed and the exit code is always 0.
//
// Config: ~/.agent-office/hook.json (AGENT_OFFICE_HOME moves the whole folder, AGENT_OFFICE_CONFIG the file)
//   { "endpoint": "https://<office>/api/events", "token": "<OFFICE_HOOK_TOKEN>",
//     "seats": [{ "seat": 3, "title": "코더" }, …],   optional, defaults in classify.mjs
//     "keepaliveSeconds": 30,                          optional
//     "projects": ["**/agent-office*", …],          optional: folders that may report (default in classify.mjs)
//     "outside": "private",                         optional: outside them, say only "비공개 작업 중"
//     "log": true }                                    optional: one line per event in ~/.agent-office/hook.log
//                                                    (event, seat, what was sent; no titles or content)
// AGENT_OFFICE_SEAT=0..3 in the environment pins the seat for sessions started from that shell.

import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PROJECTS, DEFAULT_SEATS, insideProjects, signalFor } from './classify.mjs'
import { HOME, SESSIONS, readConfig, readJson, readStdin, resolveSeat, sessionFile } from './session.mjs'

/** session files older than three days are from sessions long gone */
function sweep() {
  const cutoff = Date.now() - 3 * 86400000
  for (const f of readdirSync(SESSIONS)) {
    const p = join(SESSIONS, f)
    if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true })
  }
}

async function main() {
  const config = readConfig()
  if (!config?.endpoint || !config?.token) return
  const input = await readStdin()
  let signal = signalFor(input, undefined, config.seats ?? DEFAULT_SEATS)
  if (!signal || typeof input.session_id !== 'string') return

  mkdirSync(SESSIONS, { recursive: true })
  const file = sessionFile(input.session_id)
  const saved = readJson(file) ?? {}
  if (input.hook_event_name === 'SessionStart') sweep()

  // the title arrives on SessionStart and UserPromptSubmit (when the session has one); remember the seat
  const seat = resolveSeat(input, config, saved)
  const log = (what) =>
    config.log &&
    appendFileSync(join(HOME, 'hook.log'), `${new Date().toISOString()} ${input.hook_event_name} titled=${Boolean(input.session_title)} seat=${seat} ${what}\n`)
  // only sessions working inside the office's own repositories report (#34); the cwd is not logged or sent
  if (!insideProjects(input.cwd, config.projects ?? DEFAULT_PROJECTS)) {
    if (config.outside !== 'private') return log('skip: outside projects')
    // a private session says only that it works: no test / build outcomes, no paper planes
    if (signal.kind === 'result' || signal.kind === 'handoff') return log(`skip: private ${signal.kind}`)
    if (signal.kind === 'activity') signal = { kind: 'activity', activity: 'private' }
  }
  if (seat === null) return log('skip: no seat') // a session that isn't one of the four agents: say nothing
  // remember the seat as soon as the title gives it, whether or not the send below works: a failed send (the endpoint
  // down, #162) must not leave the next events of the session with no seat. What was last sent is saved only on success.
  if (saved.seat !== seat) writeFileSync(file, JSON.stringify({ ...saved, seat }))
  // a message to itself (or to its own role) is just a tool call
  if (signal.kind === 'handoff' && signal.to === seat) signal = { kind: 'activity', activity: 'other' }

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
  const detail = signal.activity ? `/${signal.activity}` : 'to' in signal ? ` to seat ${signal.to}` : ''
  log(`${signal.kind}${detail}${'ok' in signal ? (signal.ok ? ' pass' : ' fail') : ''} → ${res.status}`)
  if (res.ok) writeFileSync(file, JSON.stringify({ seat, kind: signal.kind, activity: signal.activity, sentAt: now }))
}

main()
  // AGENT_OFFICE_DEBUG=1 prints why nothing was sent (only to this terminal)
  .catch((e) => process.env.AGENT_OFFICE_DEBUG && console.error('office-hook:', e))
  .finally(() => process.exit(0))
