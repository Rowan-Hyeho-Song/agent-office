import { Object3D, Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice } from './glbLoad'
import { KEY_RACK, KEY_RACK_TAG, TAG_GAP, TAG_MARGIN, grow, keyAppear, keyRackTarget, keySwing, press, rackNormal, rackTag, tagPlace } from './keyRackRules'
import { wallOf } from './walls'

// #475 (office-ui.md 13.3–13.6): the key rack by the entrance door signs the owner in.

describe('a press (13.3 · 13.6)', () => {
  it('signed out: a click or Enter signs in at once', () => {
    expect(press('visitor', false, null, 1000)).toEqual({ act: 'signIn', armedAt: null })
  })
  it('signed in: never signs out, it leads to the OWNER tag (touch too)', () => {
    expect(press('owner', false, null, 1000).act).toBe('owner')
    expect(press('owner', true, null, 1000).act).toBe('owner')
    expect(press('owner', true, 500, 1000).act).toBe('owner')
  })
  it('touch: the first tap only shows it; a second within 4 s signs in; later it is a first tap again', () => {
    const first = press('visitor', true, null, 1000)
    expect(first).toEqual({ act: 'arm', armedAt: 1000 })
    expect(press('visitor', true, first.armedAt, 1000 + KEY_RACK.armMs).act).toBe('signIn')
    expect(press('visitor', true, first.armedAt, 1000 + KEY_RACK.armMs + 1)).toEqual({ act: 'arm', armedAt: 1000 + KEY_RACK.armMs + 1 })
  })
  it('the tag says what it is', () => {
    expect(rackTag('visitor', false)).toBe('주인 로그인')
    expect(rackTag('visitor', true)).toBe('주인 로그인 · 한 번 더 누르면 GitHub')
    expect(rackTag('owner', false)).toBe(KEY_RACK_TAG.owner)
    expect(rackTag('owner', true)).toBe('주인 · 들어와 있어요')
  })
})

describe('the key (13.3 · 13.4)', () => {
  it('swings once: 6° at most, still at the start and from 0.5 s on, back and forth', () => {
    const deg = Array.from({ length: 501 }, (_, i) => (keySwing(i / 1000) * 180) / Math.PI)
    expect(Math.max(...deg.map(Math.abs))).toBeCloseTo(KEY_RACK.swingDeg, 1)
    expect(keySwing(0)).toBe(0)
    expect(keySwing(KEY_RACK.swingS)).toBe(0)
    expect(keySwing(-1)).toBe(0)
    expect(keySwing(-Infinity)).toBe(0)
    expect(Math.min(...deg)).toBeLessThan(0)
    // dying away: the second half's largest angle is smaller than the first's
    const half = (a: number, b: number) => Math.max(...deg.slice(a, b).map(Math.abs))
    expect(half(250, 500)).toBeLessThan(half(0, 250))
  })
  it('hung back: fades in over 0.3 s', () => {
    expect(keyAppear(0)).toBe(0)
    expect(keyAppear(0.15)).toBeCloseTo(0.5, 5)
    expect(keyAppear(KEY_RACK.appearS)).toBe(1)
    expect(keyAppear(Infinity)).toBe(1)
  })
})

describe('the press box (13.6)', () => {
  it('a box smaller than 44 px is drawn 44 px about its centre; a bigger one is kept', () => {
    expect(grow({ left: 100, right: 120, top: 50, bottom: 60 }, 44)).toEqual({ left: 88, right: 132, top: 33, bottom: 77 })
    expect(grow({ left: 0, right: 60, top: 0, bottom: 50 }, 44)).toEqual({ left: 0, right: 60, top: 0, bottom: 50 })
  })
  it('grows 1.5x on touch; null while the model has none', () => {
    const s = new Scene()
    const hit = new Object3D()
    hit.name = 'hit_keyrack'
    hit.userData = { hit: 'keyrack', size: [0.06, 0.24, 0.4], wall: 'w' }
    hit.position.set(-4.77, 1.4, 3.3)
    s.add(hit)
    s.updateMatrixWorld(true)
    expect(keyRackTarget(s, false)!.scale.x).toBe(1)
    expect(keyRackTarget(s, true)!.scale.x).toBe(KEY_RACK.touchScale)
    expect(keyRackTarget(new Scene(), false)).toBeNull()
  })
})

describe('the baked rack (office.glb, #478)', () => {
  it('has the press box on the west wall facing into the room, and the owner\'s key as its own live node', async () => {
    const { scene, nodes } = await loadOffice()
    const box = keyRackTarget(scene, false)!
    expect(box).not.toBeNull()
    expect(wallOf(box)).toBe('w')
    expect(box.position.x).toBeCloseTo(-4.77, 2)
    expect(box.position.z).toBeCloseTo(3.3, 2)
    const n = rackNormal(box)
    expect(n.x).toBeCloseTo(1, 5)
    const key = nodes.keyrack_key
    expect(key, 'keyrack_key').toBeDefined()
    expect(key.userData.live).toBe('bot')
    expect(wallOf(key)).toBe('w')
    // the key hangs inside the press box
    expect(Math.abs(key.position.z - box.position.z)).toBeLessThan(0.2)
    expect(Math.abs(key.position.y - box.position.y)).toBeLessThan(0.12)
  })
})

describe('the tag stays on the screen (#480)', () => {
  it('over the rack, centred; pulled 8 px inside at either edge; below the rack when there is no room above', () => {
    const mid = { left: 180, right: 220, top: 300, bottom: 340 }
    expect(tagPlace(mid, 100, 20, 390)).toEqual({ left: 150, top: 300 - TAG_GAP - 20 })
    // the designer's case: a rack at a phone's left edge (x 32), a 238 px tag
    const edge = { left: 10, right: 54, top: 300, bottom: 344 }
    expect(tagPlace(edge, 238, 44, 390).left).toBe(TAG_MARGIN)
    expect(tagPlace({ left: 360, right: 400, top: 300, bottom: 340 }, 238, 44, 390).left).toBe(390 - TAG_MARGIN - 238)
    expect(tagPlace({ left: 180, right: 220, top: 20, bottom: 60 }, 100, 20, 390).top).toBe(60 + TAG_GAP)
  })
})
