import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseDocsSource } from './supabaseSource'

const row = { id: 1, kind: 'plan', repo: 'o/r', folder: 1, title: '[UI] t', agents: [], grade: 'public', approved: true, readable: true, created_at: 'a', updated_at: 'a' }

/** a stand-in for the client: records each select's columns and answers with `rows` */
function fakeClient(rows: unknown[]) {
  const selects: string[] = []
  const client = {
    from: () => ({
      select: (cols: string) => {
        selects.push(cols)
        return { order: () => ({ limit: async () => ({ data: rows, error: null }) }) }
      },
    }),
  }
  return { client: client as unknown as SupabaseClient, selects }
}

describe('the visitor covers (#236, #289)', () => {
  it('never names the labels column: a database without it (docs.sql not run again yet) still lists the library', async () => {
    const { client, selects } = fakeClient([row])
    const got = await supabaseDocsSource(client).list('visitor')
    expect(selects).toEqual(['*'])
    expect(got[0].labels).toEqual([])
  })
  it('with the column, the labels arrive (strings only)', async () => {
    const { client } = fakeClient([{ ...row, labels: ['bug', 3] }])
    expect((await supabaseDocsSource(client).list('visitor'))[0].labels).toEqual(['bug'])
  })
})
