import { describe, expect, it } from 'vitest'
import { DEFAULT_CAMERA, DEFAULT_TARGET } from './room'
import { LANDMARKS, PORTRAIT, PORTRAIT_ASPECT, defaultPose, landmarkView, portraitInfo, portraitPose, robotPx } from './portraitCamera'
import { VIEW } from './view'

const FOV = 32
const PHONE = 390 / 844
const azimuth = (p: { camera: readonly number[]; target: readonly number[] }) => Math.atan2(p.camera[0] - p.target[0], p.camera[2] - p.target[2])

describe('portraitPose', () => {
  it('is the default at aspect >= 0.8', () => {
    for (const a of [0.8, 1, 1.6, 2.2]) expect(portraitPose(a, FOV)).toEqual({ camera: [...DEFAULT_CAMERA], target: [...DEFAULT_TARGET] })
  })
  it('keeps the azimuth of the default (the room reads the same way)', () => {
    for (const a of [PHONE, 360 / 780, 0.6, 0.79]) expect(azimuth(portraitPose(a, FOV))).toBeCloseTo(azimuth(defaultPose()), 6)
  })
  it('keeps the robots at >= 0.8 x the current phone size (and not much more)', () => {
    const ref = robotPx(defaultPose(), FOV, PHONE)
    for (const a of [PHONE, 360 / 780, 0.6, 0.79]) {
      const p = portraitInfo(a, FOV)
      expect(robotPx(p, FOV, a) / ref).toBeGreaterThanOrEqual(PORTRAIT.minRobot - 1e-6)
      expect(p.robotRatio).toBeLessThan(PORTRAIT.minRobot + 0.02)
    }
  })
  it('stays inside the orbit distance limit of the free camera (no VIEW.distance change needed)', () => {
    expect(portraitInfo(PHONE, FOV).distance).toBeLessThanOrEqual(VIEW.distance[1])
  })
  it('the target stays inside the clamped target area', () => {
    const t = portraitPose(PHONE, FOV).target
    expect(Math.abs(t[0])).toBeLessThan(4.8 - VIEW.targetInset)
    expect(Math.abs(t[2])).toBeLessThan(4.1 - VIEW.targetInset)
  })
  it('keeps the work pod, the ping-pong table and the lounge fully in view; the whiteboard and omok are the edge-hint ones', () => {
    for (const a of [PHONE, 360 / 780]) {
      const v = Object.fromEntries(landmarkView(portraitPose(a, FOV), FOV, a).map((l) => [l.id, l.full]))
      expect(v).toMatchObject({ pod: true, pingpong: true, lounge: true, whiteboard: false, omok: false })
    }
  })
  it('the left-out landmarks lie on the side their hint points to', () => {
    const v = Object.fromEntries(landmarkView(portraitPose(PHONE, FOV), FOV, PHONE).map((l) => [l.id, l.cx]))
    expect(v.whiteboard).toBeGreaterThan(0)
    expect(v.omok).toBeLessThan(0)
    expect(LANDMARKS.map((l) => l.id)).toEqual(['pod', 'whiteboard', 'pingpong', 'omok', 'lounge'])
  })
  it('the threshold is a strict 0.8', () => {
    expect(portraitInfo(PORTRAIT_ASPECT - 1e-6, FOV).robotRatio).toBeCloseTo(0.8, 2)
    expect(portraitInfo(PORTRAIT_ASPECT, FOV).robotRatio).toBe(1)
  })
})
