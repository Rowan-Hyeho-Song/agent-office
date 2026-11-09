import { describe, expect, it } from 'vitest'

// #222: what a visitor can read of approvals is fixed by two views in supabase/approvals.sql. Neither may ever carry the
// title, content, options, reason, opinion or links (plan.md 6.5: the content is the owner's only).
const read = async (rel: string) => {
  const m = 'node:fs'
  const fs = (await import(/* @vite-ignore */ m)) as typeof import('node:fs')
  return fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
}
const viewSelect = (sql: string, name: string) => {
  const m = new RegExp(`create or replace view public\\.${name}[^;]*?as\\s+select([\\s\\S]*?)\\bfrom public\\.approvals`, 'i').exec(sql)
  return m ? m[1] : null
}
const PRIVATE = /\b(title|content|options|recommended|reason|opinion|result_url|source_url|requester)\b(?!_seat)/

describe('visitor views of approvals (supabase/approvals.sql)', () => {
  it('the waiting cover: id, kind, seat, time only', async () => {
    const sel = viewSelect(await read('../../supabase/approvals.sql'), 'approvals_cover')
    expect(sel).not.toBeNull()
    expect(sel!).not.toMatch(PRIVATE)
  })
  it('the decided cover: id, kind, seat, result (fixed forms only), decision time; nothing private', async () => {
    const sel = viewSelect(await read('../../supabase/approvals.sql'), 'approvals_decided_cover')
    expect(sel).not.toBeNull()
    expect(sel!).not.toMatch(PRIVATE)
    expect(sel!.replace(/\s+/g, ' ')).toMatch(/case when result in \('승인', '반려'\) or result ~ '\^선택지 \[0-9\]\+\$' then result else '결정' end as result/)
  })
})
