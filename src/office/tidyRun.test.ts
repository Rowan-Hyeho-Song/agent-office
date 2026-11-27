import { describe, expect, it } from 'vitest'
import { TIDY_S, ballOnBlade, other, startTidy, stepTidy, tidyHands, tidyPlace, type TidyRun } from './tidyRun'

// #718 ②-b (play.md 9.7 ①, #732): the tidy-up of the ping-pong table as stages: the own paddle in the left hand, the ball onto it, the partner's paddle,
// both laid by the net. A walk goes on when the body arrives (or after walkMax), a hand stage after its time.
function drive(arrive: (place: ReturnType<typeof tidyPlace>, run: TidyRun) => boolean, seconds = 60) {
  let run = startTidy('a', 7, 0)
  const seen: { stage: string; t: number }[] = [{ stage: run.stage, t: 0 }]
  for (let t = 0; t <= seconds; t += 0.05) {
    const r = stepTidy(run, { now: t * 1000, arrived: (p) => arrive(p, run) })
    run = r.run
    if (seen[seen.length - 1].stage !== run.stage) seen.push({ stage: run.stage, t })
    if (r.done) return { seen, done: t }
  }
  return { seen, done: -1 }
}

describe('the tidy-up stages (#718)', () => {
  it('take → toBall → pick → lay → toPartner → grip → toSide → put, each walk on arriving, each hand stage after its time', () => {
    const arrived = new Set(['own'])
    const at: Record<string, number> = {}
    let run = startTidy('a', 7, 0)
    const order: string[] = [run.stage]
    let done = -1
    for (let t = 0; t <= 60 && done < 0; t += 0.05) {
      const place = tidyPlace(run)
      at[run.stage] ??= t
      // the body arrives 1.5 s after a walk starts
      if (run.stage.startsWith('to') && t - at[run.stage] >= 1.5) arrived.add(place)
      const s = stepTidy(run, { now: t * 1000, arrived: (p) => arrived.has(p) && (p !== 'side' || run.stage !== 'toBall') })
      run = s.run
      if (order[order.length - 1] !== run.stage) order.push(run.stage)
      if (s.done) done = t
    }
    expect(order).toEqual(['take', 'toBall', 'pick', 'lay', 'toPartner', 'grip', 'toSide', 'put'])
    // about the hand stages plus three walks of 1.5 s
    const hands = TIDY_S.take + TIDY_S.pick + TIDY_S.lay + TIDY_S.grip + TIDY_S.put
    expect(done).toBeGreaterThan(hands + 3 * 1.5 - 0.5)
    expect(done).toBeLessThan(hands + 3 * 1.5 + 1)
  })

  it('a walk that never arrives goes on after walkMax: the tidy-up never hangs', () => {
    const r = drive(() => false)
    expect(r.done).toBeGreaterThan(0)
    expect(r.done).toBeLessThan(4 * TIDY_S.walkMax + 5)
  })

  it('the places, the hands and the ball', () => {
    const at = (stage: TidyRun['stage']) => tidyPlace({ own: 'b', block: 1, stage, t0: 0 })
    expect([at('take'), at('toBall'), at('pick'), at('lay'), at('toPartner'), at('grip'), at('toSide'), at('put')]).toEqual(['own', 'ball', 'ball', 'ball', 'partner', 'partner', 'side', 'side'])
    expect(tidyHands('take')).toEqual({ left: true, right: null })
    expect(tidyHands('pick').right).toBe('ball')
    expect(tidyHands('lay').right).toBe('ball')
    expect(tidyHands('toPartner').right).toBeNull()
    expect(tidyHands('grip').right).toBe('paddle')
    expect(tidyHands('put').right).toBe('paddle')
    expect(ballOnBlade('lay')).toBe(false)
    expect(ballOnBlade('toPartner')).toBe(true)
    expect(other('a')).toBe('b')
  })
})
