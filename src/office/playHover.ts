// #670 (play.md 2.1.1) the visitor's play tags ("같이 두기" · "라켓 잡기") with a mouse: shown only while the pointer is over the play spot (the game
// table and its chairs, the ping-pong table) or over the tag itself, after a short wait, and put away a while after it leaves. A keyboard focus shows
// it and a screen that is not a mouse's always does (styles.css); a touch press on a mouse's screen (a two-way laptop) shows it from then on. The rigs
// ask `overSpot` each frame; the tags ask `useTagAway` whether they are put away.

import { useEffect, useState } from 'react'
import { Box3, Vector3, type Camera } from 'three'

/** play.md 2.1.1: the margin round the spot's screen rectangle, the wait before the tag shows, and how long it stays after the pointer leaves */
export const TAG_HOVER = { padPx: 12, showMs: 120, lingerMs: 400 } as const
/** the game table's top (gt_top, baked into the room: a disc of radius 0.42 m round the board) and its chairs round their nav spots (game_a ·
 * game_b): half their footprint (m) */
export const GAME_TOP_HALF_M = 0.42
export const CHAIR_HALF_M = 0.25

export type TagKind = 'omok' | 'pingpong'

/** a part of the spot on the floor plan: its middle and half its size along x and z (m) */
export interface SpotPart {
  x: number
  z: number
  hx: number
  hz: number
}

/** the play spot's box round its parts (the table top, the chairs), from the floor up to `top` (the tag's place) */
export function spotBox(parts: (SpotPart | null | undefined)[], top: number, floor = 0): Box3 | null {
  const box = new Box3()
  for (const p of parts) {
    if (!p) continue
    box.expandByPoint(new Vector3(p.x - p.hx, floor, p.z - p.hz))
    box.expandByPoint(new Vector3(p.x + p.hx, floor, p.z + p.hz))
  }
  if (box.isEmpty()) return null
  box.min.y = Math.min(box.min.y, floor)
  box.max.y = Math.max(box.max.y, top)
  return box
}

export type Rect = [left: number, top: number, right: number, bottom: number]

/** the box's eight corners on the screen (px): their outer rectangle, or null while part of it is behind the camera */
export function screenRect(box: Box3, camera: Camera, w: number, h: number): Rect | null {
  const r: Rect = [Infinity, Infinity, -Infinity, -Infinity]
  const c = new Vector3()
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera)
    if (c.z >= 1 || c.z <= -1) return null
    const x = ((c.x + 1) / 2) * w
    const y = ((1 - c.y) / 2) * h
    r[0] = Math.min(r[0], x)
    r[1] = Math.min(r[1], y)
    r[2] = Math.max(r[2], x)
    r[3] = Math.max(r[3], y)
  }
  return r
}

export const inRect = (r: Rect, x: number, y: number, pad = 0) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad

// the mouse over the page: where, and over what; null for a pen or touch, or off the window
let mouse: { x: number; y: number; target: EventTarget | null } | null = null
/** a camera drag (a button held while moving): the answers stay as they were */
let dragging = false
/** a touch press came: a two-way device, the tags always show from now on (until a reload) */
let touched = false
let users = 0
let canvasEl: HTMLElement | null = null
const tagEls: Record<TagKind, HTMLElement | null> = { omok: null, pingpong: null }
const last: Record<TagKind, boolean> = { omok: false, pingpong: false }

const onMove = (e: PointerEvent) => {
  if (e.pointerType === 'touch') touched = true
  dragging = e.pointerType === 'mouse' && e.buttons !== 0
  mouse = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY, target: e.target } : null
}
const onUp = (e: PointerEvent) => {
  if (e.pointerType === 'mouse') dragging = false
}
const onOut = (e: MouseEvent) => {
  if (!e.relatedTarget) mouse = null
}

/** the rigs: follow the mouse while mounted (shared, counted) */
export function trackMouse(canvas: HTMLElement): () => void {
  canvasEl = canvas
  if (users++ === 0) {
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    document.addEventListener('mouseout', onOut, true)
  }
  return () => {
    if (--users > 0) return
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerdown', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('mouseout', onOut, true)
    mouse = null
    dragging = false
    canvasEl = null
  }
}

/** the tag's element (its ref), for its own rectangle */
export const setTagEl = (kind: TagKind, el: HTMLElement | null) => (tagEls[kind] = el)

/** for tests */
export function setPointerForTest(m: { x: number; y: number; on: 'canvas' | 'tag' | 'other' } | null, opts: { dragging?: boolean; touched?: boolean } = {}, kind: TagKind = 'omok') {
  const other = {} as EventTarget
  canvasEl ??= {} as HTMLElement
  mouse = m && { x: m.x, y: m.y, target: m.on === 'canvas' ? canvasEl : m.on === 'tag' ? tagEls[kind] : other }
  dragging = !!opts.dragging
  touched = !!opts.touched
}

/**
 * Whether the pointer is over the play spot: the box's screen rectangle + 12 px, or the tag's own rectangle; counted only over the canvas or the
 * tag (not a dock, the agent list or a bubble). During a camera drag the last answer stands. After a touch press: always.
 */
export function overSpot(kind: TagKind, box: Box3 | null, camera: Camera, w: number, h: number): boolean {
  if (touched) return (last[kind] = true)
  if (dragging) return last[kind]
  const tag = tagEls[kind]
  const m = mouse
  let hot = false
  if (m && (m.target === canvasEl || (tag && (m.target === tag || (typeof Node !== 'undefined' && m.target instanceof Node && tag.contains(m.target)))))) {
    const r = box && screenRect(box, camera, w, h)
    if (r && inRect(r, m.x, m.y, TAG_HOVER.padPx)) hot = true
    else if (tag) {
      const t = tag.getBoundingClientRect()
      hot = inRect([t.left, t.top, t.right, t.bottom], m.x, m.y)
    }
  }
  return (last[kind] = hot)
}

/** how long until the tag follows the pointer (shown → put away or back), or null when it already does */
export const tagWait = (hot: boolean, shown: boolean): number | null => (hot === shown ? null : hot ? TAG_HOVER.showMs : TAG_HOVER.lingerMs)

/** the tag's linger: shown `showMs` after the pointer comes (`hot`), put away `lingerMs` after it goes; coming back meanwhile cancels either */
export function useTagAway(hot: boolean): boolean {
  const [shown, setShown] = useState(hot)
  useEffect(() => {
    const ms = tagWait(hot, shown)
    if (ms === null) return
    const id = setTimeout(() => setShown(hot), ms)
    return () => clearTimeout(id)
  }, [hot, shown])
  return !shown
}
