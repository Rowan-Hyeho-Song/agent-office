import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../../approvals/source'
import { ownerMeta, stringsOnly, type CoverSource, type DocBody, type DocMeta } from '../../docs/library'
import type { DocsSource } from '../../docs/source'

const COLS = 'id, kind, repo, folder, title, agents, grade, approved, created_at, updated_at'
/** the issue's labels live in the document's `data` (the Action stores them for a plan); the view hands them out as `labels` */
const OWNER_COLS = `${COLS}, labels:data->labels`
const LIMIT = 1000

/**
 * The real source. Visitors read the docs_cover view (every document's cover: no title while SECRET, no project or
 * number for `private`) and, for public + approved documents, the table itself (RLS). The owner reads the table (RLS:
 * is_owner), `private` rows only as covers. Nothing is filtered here: what must stay hidden never arrives.
 */
export function supabaseDocsSource(supabase: SupabaseClient): DocsSource {
  return {
    async list(role: Role): Promise<DocMeta[]> {
      if (role === 'owner') {
        const { data, error } = await supabase.from('docs').select(OWNER_COLS).order('created_at').limit(LIMIT)
        if (error) throw error
        return (data as CoverSource[]).map(ownerMeta)
      }
      // `*`: the view hands out only cover columns, and `labels` (#236) arrives once supabase/docs.sql has been run again; naming
      // it would make the whole read fail (400, undefined column) on a database that is a step behind the code (#289)
      const { data, error } = await supabase.from('docs_cover').select('*').order('created_at').limit(LIMIT)
      if (error) throw error
      return (data as DocMeta[]).map((d) => ({ ...d, labels: stringsOnly(d.labels) }))
    },
    async read(ids: number[]): Promise<DocBody[]> {
      if (!ids.length) return []
      const { data, error } = await supabase.from('docs').select('id, body, data, source_url').in('id', ids).neq('grade', 'private')
      if (error) throw error
      return data as DocBody[]
    },
  }
}
