// What just happened at an agent, for the tour's score 6 (#207, office-ui.md 10.2): a paper plane thrown or caught, a test /
// build result, the stamp, an omok win, a ping-pong point. The scene calls `noteTourEvent` where it already knows (a line at
// each place, like the play sounds); the tour reads `tourEventOf`. Real time (Date.now), not office time.

export interface TourEvent {
  at: number
  until: number
}

const events = new Map<string, TourEvent>()

/** an event at `agent` that lasts `durMs`; one that is still going is extended (its start stays: a new event is one that begins after a cut began) */
export function noteTourEvent(agent: string, durMs: number, now = Date.now()) {
  const cur = events.get(agent)
  if (cur && now <= cur.until) cur.until = Math.max(cur.until, now + durMs)
  else events.set(agent, { at: now, until: now + durMs })
}

export const tourEventOf = (agent: string): TourEvent | undefined => events.get(agent)
export const clearTourEvents = () => events.clear()
