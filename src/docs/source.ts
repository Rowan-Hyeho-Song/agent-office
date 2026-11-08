// Where the library viewer gets its documents. One interface, two implementations: Supabase (office/docs/supabaseSource.ts)
// and a fake that exists only under ?debug=1 (fakeSource.ts). The page never filters: the source hands over only what
// this role may see (the server's docs_cover view and the table's RLS; the fake mirrors them with coverOf / ownerMeta).

import type { Role } from '../approvals/source.js'
import type { DocBody, DocMeta } from './library.js'

export interface DocsSource {
  /** every document as this role sees it: SECRET without title, `private` without project and number */
  list(role: Role): Promise<DocMeta[]>
  /** bodies of readable documents; others are simply not in the answer */
  read(ids: number[], role: Role): Promise<DocBody[]>
  /** something changed (debug fake only; the real source is polled) */
  subscribe?(cb: () => void): () => void
}
