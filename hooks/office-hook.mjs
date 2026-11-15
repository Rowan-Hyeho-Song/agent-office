#!/usr/bin/env node
// Claude Code hook → agent office (#1). Register it for SessionStart, UserPromptSubmit, PreToolUse, Stop,
// SessionEnd, and (#44) PostToolUse / PostToolUseFailure on Bash|PowerShell, all with "async": true (see
// hooks/README.md), so it never slows a tool call.
//
// Per event it sends at most { seat, kind, activity } to /api/events, plus { repo, issue } when the folder declared
// the issue it works on (hooks/task.mjs, #182), plus ok (true / false) after a test or
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
//     "repos": ["agent-office", "rowansong.dev"],   optional: repos a declared task may name (#182)
//     "log": true,                                     optional: one line per event in ~/.agent-office/hook.log
//                                                    (event, seat, what was sent; no titles or content)
//     "backgroundMinutes": 20 }                        optional (#535): a turn that ended with background work still running says so
//                                                    (background / bg_test / bg_build / bg_delegate); if the session has not woken this
//                                                    long after, the hook ends it with a stop
// AGENT_OFFICE_SEAT=0..4 in the environment pins the seat for sessions started from that shell.

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND, BACKGROUND_MINUTES, DEFAULT_PROJECTS, DEFAULT_SEATS, backgroundOver, insideProjects, signalFor } from './classify.mjs'
import { DEFAULT_REPOS, taskFor } from './task.mjs'
import { HOME, SESSIONS, readConfig, readJson, readStdin, resolveSeat, sessionFile } from './session.mjs'

/** session files older than three days are from sessions long gone */
function sweep() {
  const cutoff = Date.now() - 3 * 86400000
  for (const f of readdirSync(SESSIONS)) {
    const p = join(SESSIONS, f)
    if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true })
  }
}

/**
 * #535: the background wait's end, run detached by the hook after it said a session waits on background work: after the time it ends the wait with a
 * stop, unless the session has said anything since (it woke when the work was done). Sends only { seat, kind: 'stop' }.
 */
async function expire(file, at, minutes, config) {
  await new Promise((r) => setTimeout(r, Math.max(0, at + minutes * 60000 - Date.now())))
  const saved = readJson(file)
  if (!backgroundOver(saved, at, Date.now(), minutes)) return
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ seat: saved.seat, kind: 'stop' }),
    signal: AbortSignal.timeout(4000),
  })
  if (config.log) appendFileSync(join(HOME, 'hook.log'), `${new Date().toISOString()} BackgroundExpire seat=${saved.seat} stop → ${res.status}\n`)
  if (res.ok) writeFileSync(file, JSON.stringify({ ...saved, kind: 'stop', activity: undefined, sentAt: Date.now() }))
}

async function main() {
  const config = readConfig()
  if (!config?.endpoint || !config?.token) return
  // #535: the detached end of a background wait (node office-hook.mjs --expire <session file> <sent at> <minutes>)
  if (process.argv[2] === '--expire') return expire(process.argv[3], Number(process.argv[4]), Number(process.argv[5]), config)
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
  const inside = insideProjects(input.cwd, config.projects ?? DEFAULT_PROJECTS)
  if (!inside) {
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

  // #182: the issue declared for this folder (hooks/task.mjs): only the repo name and the number go out, and only for
  // sessions inside the project folders; a private-mode ("outside") session never carries one
  const task = inside ? taskFor(input.cwd, config.repos ?? DEFAULT_REPOS) : null
  // the same activity again within the keepalive window: nothing new to say
  const now = Date.now()
  const keepalive = (config.keepaliveSeconds ?? 30) * 1000
  const taskKey = task ? `${task.repo}#${task.issue}` : ''
  const same = signal.kind === 'activity' && saved.kind === 'activity' && saved.activity === signal.activity && (saved.task ?? '') === taskKey
  if (same && saved.seat === seat && now - (saved.sentAt ?? 0) < keepalive) return log(`skip: same ${signal.activity}`)

  const send = (withTask) =>
    fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ seat, ...signal, ...(withTask && task ? task : {}) }),
      signal: AbortSignal.timeout(4000),
    })
  let res = await send(true)
  // a server from before #182 answers 400 to the extra fields: say it again once without them, so declaring an issue
  // before that deploy never silences the agent. Only then (a 400 with a task on it); the saved task key stays as it is,
  // so the keepalive keeps comparing the same thing
  if (res.status === 400 && task) {
    log(`task dropped → ${res.status}`)
    res = await send(false)
  }
  // #535: a server from before #535 does not know the background waits and answers 400: say the turn's end as it was said before (stop), once,
  // so taking this hook before that deploy never loses the end of a turn
  if (res.status === 400 && signal.kind === 'activity' && BACKGROUND.includes(signal.activity)) {
    log(`activity/${signal.activity} → ${res.status}, said as stop`)
    signal = { kind: 'stop' }
    res = await send(true)
    if (res.status === 400 && task) res = await send(false)
  }
  const detail = signal.activity ? `/${signal.activity}` : 'to' in signal ? ` to seat ${signal.to}` : ''
  log(`${signal.kind}${detail}${'ok' in signal ? (signal.ok ? ' pass' : ' fail') : ''} → ${res.status}`)
  if (res.ok) writeFileSync(file, JSON.stringify({ seat, kind: signal.kind, activity: signal.activity, task: taskKey, sentAt: now }))
  // #535: a background wait ends by itself after backgroundMinutes if the session does not wake (a process of its own: the hook returns now)
  if (res.ok && signal.kind === 'activity' && BACKGROUND.includes(signal.activity)) {
    const minutes = Number(config.backgroundMinutes) > 0 ? Number(config.backgroundMinutes) : BACKGROUND_MINUTES
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--expire', file, String(now), String(minutes)], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
}

main()
  // AGENT_OFFICE_DEBUG=1 prints why nothing was sent (only to this terminal)
  .catch((e) => process.env.AGENT_OFFICE_DEBUG && console.error('office-hook:', e))
  .finally(() => process.exit(0))
