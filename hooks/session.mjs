// What the office's hooks share (#1, #25): the config file, the local per-session file, and how a session's
// seat is decided. Seats are only decided for sessions inside the office's own repositories (#34); callers
// check insideProjects first.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SEATS, seatFor } from './classify.mjs'

export const HOME = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.agent-office')
export const SESSIONS = join(HOME, 'sessions')

export const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** ~/.agent-office/hook.json (AGENT_OFFICE_CONFIG moves the file) */
export const readConfig = () => readJson(process.env.AGENT_OFFICE_CONFIG ?? join(HOME, 'hook.json'))

export async function readStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return JSON.parse(data || '{}')
}

/** the local file that remembers a session's seat; the session id only names it and is never sent */
export const sessionFile = (sessionId) => join(SESSIONS, `${String(sessionId).replace(/[^\w-]/g, '')}.json`)

/**
 * The seat: AGENT_OFFICE_SEAT pins it; else the session title (SessionStart / UserPromptSubmit carry it);
 * else what this session was given before. null = not one of the four agents.
 * @param {{ session_title?: string }} input
 * @param {{ seats?: { seat: number, title: string }[] }} config
 * @param {{ seat?: number }} saved
 * @param {string} [pinnedEnv]
 */
export function resolveSeat(input, config, saved, pinnedEnv = process.env.AGENT_OFFICE_SEAT) {
  const pinned = Number.parseInt(pinnedEnv ?? '', 10)
  if (Number.isInteger(pinned) && pinned >= 0 && pinned <= 3) return pinned
  const fromTitle = seatFor(input.session_title, config.seats ?? DEFAULT_SEATS)
  if (fromTitle !== null) return fromTitle
  return Number.isInteger(saved?.seat) ? saved.seat : null
}
