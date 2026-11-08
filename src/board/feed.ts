// Feeds the board from the library store (live data): whenever the document list (or a decision's body) changes,
// derive the BoardState again. The store drops a change that would draw the same, so nothing repaints needlessly.

import type { LibraryStore } from '../docs/store'
import { decisionIds, boardFromLibrary } from './state'
import type { BoardStore } from './store'

export function feedBoardFromLibrary(library: LibraryStore, board: BoardStore): () => void {
  const apply = () => {
    const { metas, folders, bodies } = library.getSnapshot()
    if (!metas) return
    void library.ensure(decisionIds(folders)) // the notes quote the chosen option, which lives in the body
    board.set(boardFromLibrary(folders, bodies))
  }
  apply()
  return library.subscribe(apply)
}
