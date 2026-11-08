import { describe, expect, it } from 'vitest'
import type { StatusRow } from './events'
import { createSupabaseStore, isMissingColumn } from './store'

const NOW = '2026-01-01T00:00:00.000Z'
const row: StatusRow = {
  seat: 3, state: 'working', activity: 'edit', since: NOW, updated_at: NOW,
  last_result_activity: null, last_result_ok: null, last_result_at: null,
  task_repo: 'agent-office', task_issue: 170, task_title: null, task_private: false,
}
const missing = (name: string) => new Error(`supabase 400: {"code":"42703","message":"column agent_status.${name} does not exist"}`)

/** a fake PostgREST: agent_status has no task_* columns until `migrated` */
function fakeRest(migrated: boolean) {
  const calls: { path: string; body?: Record<string, unknown> }[] = []
  const rest = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ path, body })
    if (!migrated && path.includes('task_repo')) throw missing('task_repo')
    if (!migrated && body && 'task_repo' in body) throw new Error(`supabase 400: {"code":"PGRST204","message":"Could not find the 'task_repo' column of 'agent_status' in the schema cache"}`)
    return (path.startsWith('agent_status?select') ? [{ seat: 3, state: 'idle' }] : null) as T
  }
  return { rest, calls }
}

describe('isMissingColumn', () => {
  it('only for missing columns', () => {
    expect(isMissingColumn(missing('task_repo'))).toBe(true)
    expect(isMissingColumn(new Error('supabase 401: invalid api key'))).toBe(false)
  })
})

describe('createSupabaseStore before the SQL is applied (#182)', () => {
  it('reads without the task columns and remembers it', async () => {
    const f = fakeRest(false)
    const store = createSupabaseStore(f.rest)
    expect(await store.status(3)).toMatchObject({ seat: 3 })
    await store.status(3)
    expect(f.calls.map((c) => c.path.includes('task_repo'))).toEqual([true, false, false])
  })

  it('writes without the task fields after a missing-column error, once, then keeps doing so', async () => {
    const f = fakeRest(false)
    const store = createSupabaseStore(f.rest)
    await store.setStatus(row)
    await store.setStatus(row)
    expect(f.calls.map((c) => c.body && 'task_repo' in c.body)).toEqual([true, false, false])
    expect(f.calls[1].body).toMatchObject({ seat: 3, state: 'working' })
    expect(Object.keys(f.calls[1].body!).some((k) => k.startsWith('task_'))).toBe(false)
  })

  it('other errors still fail', async () => {
    const store = createSupabaseStore(async () => Promise.reject(new Error('supabase 500: boom')))
    await expect(store.setStatus(row)).rejects.toThrow('boom')
    await expect(store.status(3)).rejects.toThrow('boom')
  })

  it('after the SQL is applied everything goes through with the task', async () => {
    const f = fakeRest(true)
    const store = createSupabaseStore(f.rest)
    await store.status(3)
    await store.setStatus(row)
    expect(f.calls[0].path).toContain('task_repo')
    expect(f.calls[1].body).toMatchObject({ task_repo: 'agent-office', task_issue: 170 })
  })
})
