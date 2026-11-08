// The Supabase-backed Store of /api/events, with the PostgREST helper injected so it can be tested (#182).
//
// The four task_* columns of agent_status come from supabase/office.sql, which is applied separately from the
// deploy. Until it is, a read or write that names them fails ("column ... does not exist" / PGRST204): the store
// then retries once without them and remembers that for this function instance, so signals are still stored.

import type { StatusRow, Store } from './events.js'

const BASE = 'seat,state,activity,since,updated_at,last_result_activity,last_result_ok,last_result_at'
const TASK = 'task_repo,task_issue,task_title,task_private'
const TASK_KEYS = TASK.split(',')

/** PostgREST / Postgres say a column is missing: 42703 (undefined_column), PGRST204 (not in the schema cache) */
export const isMissingColumn = (e: unknown) => /42703|PGRST204|column .* does not exist|Could not find the '.*' column/i.test(String((e as Error | undefined)?.message ?? e))

type Rest = <T>(path: string, init?: RequestInit) => Promise<T>

export function createSupabaseStore(rest: Rest): Store {
  let noTask = false
  return {
    async status(seat) {
      const read = (cols: string) => rest<StatusRow[]>(`agent_status?select=${cols}&seat=eq.${seat}`)
      let rows: StatusRow[]
      if (noTask) rows = await read(BASE)
      else
        try {
          rows = await read(`${BASE},${TASK}`)
        } catch (e) {
          if (!isMissingColumn(e)) throw e
          noTask = true
          rows = await read(BASE)
        }
      return rows?.[0] ?? null
    },
    async setStatus(row) {
      const write = (r: StatusRow) =>
        rest('agent_status?on_conflict=seat', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(r) })
      const bare = () => Object.fromEntries(Object.entries(row).filter(([k]) => !TASK_KEYS.includes(k))) as unknown as StatusRow
      if (noTask) return void (await write(bare()))
      try {
        await write(row)
      } catch (e) {
        if (!isMissingColumn(e)) throw e
        noTask = true
        await write(bare())
      }
    },
    // the title of a public issue's plan document: public + approved rows only (what any visitor could read)
    async issueTitle(repo, issue) {
      const rows = await rest<{ title: string }[]>(
        `docs?select=title&kind=eq.plan&grade=eq.public&approved=eq.true&repo=eq.${encodeURIComponent(repo)}&folder=eq.${issue}&order=created_at.asc&limit=1`,
      )
      return rows?.[0]?.title ?? null
    },
    async addEvent(e) {
      await rest('agent_events', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(e) })
    },
    async prune(before) {
      await rest(`agent_events?created_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    },
  }
}
