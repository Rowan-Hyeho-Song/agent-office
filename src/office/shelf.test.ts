import { describe, expect, it } from 'vitest'
import { EMPTY_LIBRARY } from './Shelf'

describe('Shelf without a library (#94)', () => {
  // useSyncExternalStore re-renders forever when getSnapshot hands out a new object each call: the plain page
  // (no Supabase, not ?debug=1) never drew the office
  it('the empty snapshot is the same object every time', () => {
    expect(EMPTY_LIBRARY.getSnapshot()).toBe(EMPTY_LIBRARY.getSnapshot())
  })
})
