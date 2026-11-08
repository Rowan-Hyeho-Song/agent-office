#!/usr/bin/env node
// Declares the issue a session works on (#182), so the office can show "작업 중 › #170 …". Only the repo name
// and the issue number are ever sent; the office looks the title up from public information itself.
//
//   node hooks/task.mjs agent-office 170   this folder (and the folders under it) works on that issue
//   node hooks/task.mjs --clear            forget it
//   node hooks/task.mjs                    print what is declared for this folder
//
// Scope: per working directory. It is stored in ~/.agent-office/tasks.json (AGENT_OFFICE_HOME moves the folder),
// keyed by the git checkout's top folder (or the current folder outside git), so every session started in that
// worktree reports it, and a different worktree has its own. AGENT_OFFICE_TASK=<repo>#<n> in the environment
// pins it for sessions started from that shell and wins over the file. The hook sends it only for sessions
// inside the office's own project folders, and never for a private-mode ("outside") session.
//
// The repo must be in the hook config's "repos" (default below); the number a positive integer.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOME, readConfig, readJson } from './session.mjs'

export const DEFAULT_REPOS = ['agent-office', 'rowansong.dev']
export const MAX_ISSUE = 1_000_000
export const TASKS_FILE = () => join(HOME, 'tasks.json')

/** the same normal form insideProjects uses: forward slashes, no trailing slash, lower case */
export const keyOf = (path) => String(path ?? '').replaceAll(String.fromCharCode(92), '/').replace(/\/+$/, '').toLowerCase()

/** @returns {{ repo: string, issue: number } | null} the repo as the allow-list spells it, or null */
export function validTask(repo, issue, repos = DEFAULT_REPOS) {
  const n = typeof issue === 'string' && /^\d{1,7}$/.test(issue) ? Number(issue) : issue
  if (typeof repo !== 'string' || !Number.isInteger(n) || n < 1 || n > MAX_ISSUE) return null
  const want = repo.trim().toLowerCase()
  const hit = repos.find((r) => r.toLowerCase() === want)
  return hit ? { repo: hit, issue: n } : null
}

/** "agent-office#170" (AGENT_OFFICE_TASK) */
export function parseTaskEnv(value, repos = DEFAULT_REPOS) {
  const m = /^\s*([\w./-]+)#(\d+)\s*$/.exec(value ?? '')
  return m ? validTask(m[1], m[2], repos) : null
}

/** the declared task for a session cwd: the env pin, else the nearest declared folder at or above cwd */
export function taskFor(cwd, repos = DEFAULT_REPOS, tasks = readJson(TASKS_FILE()) ?? {}, env = process.env.AGENT_OFFICE_TASK) {
  const pinned = env ? parseTaskEnv(env, repos) : null
  if (pinned) return pinned
  let path = keyOf(cwd)
  while (path) {
    const t = tasks[path]
    if (t) return validTask(t.repo, t.issue, repos)
    const up = path.slice(0, path.lastIndexOf('/'))
    if (up === path) break
    path = up
  }
  return null
}

/** the folder a declaration belongs to: the git checkout's top, or cwd outside git */
export function scopeOf(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd
  } catch {
    return cwd
  }
}

function save(tasks) {
  mkdirSync(dirname(TASKS_FILE()), { recursive: true })
  writeFileSync(TASKS_FILE(), JSON.stringify(tasks, null, 2))
}

function main(args) {
  const config = readConfig() ?? {}
  const repos = config.repos ?? DEFAULT_REPOS
  const scope = keyOf(scopeOf(process.cwd()))
  const tasks = readJson(TASKS_FILE()) ?? {}
  if (args[0] === '--clear') {
    delete tasks[scope]
    save(tasks)
    return console.log('작업 이슈를 지웠어요.')
  }
  if (args.length === 0) {
    const t = taskFor(process.cwd(), repos, tasks)
    return console.log(t ? `${t.repo}#${t.issue}` : '(없음)')
  }
  const t = args.length === 1 ? parseTaskEnv(args[0], repos) : validTask(args[0], args[1], repos)
  if (!t) {
    console.error(`usage: node hooks/task.mjs <repo> <issue> | --clear   (repo: ${repos.join(', ')}; issue: 1..${MAX_ISSUE})`)
    process.exitCode = 1
    return
  }
  tasks[scope] = { repo: t.repo, issue: t.issue, at: new Date().toISOString() }
  save(tasks)
  console.log(`작업 이슈: ${t.repo}#${t.issue} (이 폴더 ${scope})`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main(process.argv.slice(2))
