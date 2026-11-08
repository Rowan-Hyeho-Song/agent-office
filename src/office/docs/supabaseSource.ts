import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role } from '../../approvals/source'
import { ownerMeta, type CoverSource, type DocBody, type DocMeta } from '../../docs/library'
import type { DocsSource } from '../../docs/source'

const COLS = 'id, kind, repo, folder, title, agents, grade, approved, created_at, updated_at'
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
        const { data, error } = await supabase.from('docs').select(COLS).order('created_at').limit(LIMIT)
        if (error) throw error
        return (data as CoverSource[]).map(ownerMeta)
      }
      const { data, error } = await supabase.from('docs_cover').select(`${COLS}, readable`).order('created_at').limit(LIMIT)
      if (error) throw error
      return data as DocMeta[]
    },
    async read(ids: number[]): Promise<DocBody[]> {
      if (!ids.length) return []
      const { data, error } = await supabase.from('docs').select('id, body, data, source_url').in('id', ids).neq('grade', 'private')
      if (error) throw error
      return data as DocBody[]
    },
  }
}
