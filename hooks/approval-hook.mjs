#!/usr/bin/env node
// Claude Code hook: new approval results → this session's context (#25, plan.md 6.5).
// Register for SessionStart and UserPromptSubmit WITHOUT "async" (its output is the point) and with a short
// timeout (hooks/README.md). For those two events Claude Code adds what a hook prints to the conversation.
//
// It asks /api/approvals for results decided since it last looked, for this session's seat only, and prints
// them once. What it can print is narrow by construction (#38): the server only keeps the owner's 🖊 requests
// and the owner's ✅ answers, so nobody else can put words into an agent's context this way. It never sends
// anything about the session except the seat number, and stays silent outside the office's repositories.
//
// Config: the same ~/.agent-office/hook.json as office-hook.mjs; "approvalsEndpoint" overrides the URL
// (default: "endpoint" with /api/events → /api/approvals).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatApprovals } from './approvals.mjs'
import { DEFAULT_PROJECTS, insideProjects } from './classify.mjs'
import { HOME, readConfig, readJson, readStdin, resolveSeat, sessionFile } from './session.mjs'

/** on the very first run, look back this far */
const FIRST_LOOK_MS = 24 * 3600 * 1000

async function main() {
  const config = readConfig()
  if (!config?.endpoint || !config?.token) return
  const input = await readStdin()
  if (input.hook_event_name !== 'SessionStart' && input.hook_event_name !== 'UserPromptSubmit') return
  if (typeof input.session_id !== 'string') return
  if (!insideProjects(input.cwd, config.projects ?? DEFAULT_PROJECTS)) return
  const seat = resolveSeat(input, config, readJson(sessionFile(input.session_id)) ?? {})
  if (seat === null) return

  const url = config.approvalsEndpoint ?? String(config.endpoint).replace(/\/api\/events\/?$/, '/api/approvals')
  const seenFile = join(HOME, `approvals-seat-${seat}.json`)
  const since = readJson(seenFile)?.since ?? new Date(Date.now() - FIRST_LOOK_MS).toISOString()
  const res = await fetch(`${url}?seat=${seat}&since=${encodeURIComponent(since)}`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) return
  const { approvals } = await res.json()
  if (!Array.isArray(approvals) || !approvals.length) return
  process.stdout.write(`${formatApprovals(approvals)}\n`)
  // remember the newest one so each result is handed over once
  mkdirSync(HOME, { recursive: true })
  writeFileSync(seenFile, JSON.stringify({ since: approvals[approvals.length - 1].decided_at }))
}

main()
  .catch((e) => process.env.AGENT_OFFICE_DEBUG && console.error('approval-hook:', e))
  .finally(() => process.exit(0))
