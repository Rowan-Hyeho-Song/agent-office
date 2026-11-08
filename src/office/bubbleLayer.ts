// The DOM side of the speech bubbles and status tags (docs/design/office-ui.md section 3): one overlay over the canvas,
// elements kept per agent, only their position / text changes per frame (no React re-render). What to draw comes from
// bubbles.ts (BubbleItem, statusTag, placeBubbles); this file only makes elements and writes styles. The look is
// src/styles/bubbles.css (the design mock's classes: .ob, .ot).

import { pairSide, placeBubbles, type BubbleItem, type PlaceInput } from './bubbles'
import { iconSvg } from './bubbleIcons'

const TAB = ['MEMO', 'MESH', 'HUE', 'LOOP']
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

import { DOZE } from './doze'

export interface Anchor {
  x: number
  y: number
  visible: boolean
}

export interface TagItem {
  id: string
  seat: number
  icon: string
  label: string
  private: boolean
}

export interface LayerView {
  w: number
  h: number
  narrow: boolean
}

export interface OpenTarget {
  repo: string
  n: number
  row: string
}

interface Live {
  el: HTMLElement
  key: string
  card: HTMLElement
  typedEl: HTMLElement
  ghostEl: HTMLElement
  text: HTMLElement
  chars: string[]
  typed: number
  w: number
  h: number
  measuredNarrow: boolean | null
  open: string
  style: string
  leaving: boolean
}

const LOG_KEEP = 20

export class BubbleLayer {
  readonly root: HTMLElement
  private log: HTMLElement
  private bubbles = new Map<string, Live>()
  private tags = new Map<string, { el: HTMLElement; label: string; style: string }>()
  private logged = new Set<string>()
  /** the floating "z" of each dozing agent (#110): a holder at the head with the live z elements inside */
  private zs = new Map<string, { el: HTMLElement; next: number }>()

  constructor(private onOpen: (t: OpenTarget) => void) {
    this.root = document.createElement('div')
    this.root.className = 'ob-layer'
    this.log = document.createElement('div')
    this.log.className = 'sr-only'
    this.log.setAttribute('role', 'log')
    this.log.setAttribute('aria-live', 'polite')
    this.log.setAttribute('aria-label', '사무실 대화')
    this.root.append(this.log)
  }

  mount(parent: HTMLElement = document.body) {
    parent.append(this.root)
  }

  dispose() {
    this.root.remove()
    this.bubbles.clear()
    this.tags.clear()
    this.zs.clear()
  }

  /**
   * A "z" floats up from each dozing agent every DOZE.z.everyS, at most DOZE.z.max alive (#110). `t` is seconds.
   * Reduced motion: none at all (the tag's icon says it).
   */
  updateZ(sleepers: { id: string; seat: number }[], anchors: Record<string, Anchor>, t: number, reduced: boolean) {
    const want = new Set(reduced ? [] : sleepers.map((s) => s.id))
    for (const [id, z] of this.zs) {
      if (!want.has(id)) {
        z.el.remove()
        this.zs.delete(id)
      }
    }
    for (const s of sleepers) {
      if (!want.has(s.id)) continue
      let z = this.zs.get(s.id)
      if (!z) {
        const el = document.createElement('div')
        el.className = 'ot oz'
        el.dataset.agent = String(s.seat)
        el.setAttribute('aria-hidden', 'true')
        this.root.append(el)
        // staggered by seat so four sleepers don't puff in unison
        z = { el, next: t + (s.seat * DOZE.z.everyS) / 4 }
        this.zs.set(s.id, z)
      }
      const a = anchors[s.id]
      z.el.style.display = a?.visible ? '' : 'none'
      if (a) {
        z.el.style.setProperty('--x', `${Math.round(a.x)}px`)
        z.el.style.setProperty('--y', `${Math.round(a.y)}px`)
      }
      if (t >= z.next && a?.visible) {
        z.next = t + DOZE.z.everyS
        if (z.el.childElementCount < DOZE.z.max) {
          const p = document.createElement('span')
          p.className = 'oz-z'
          p.textContent = 'z'
          p.style.setProperty('--rise', `${DOZE.z.risePx}px`)
          p.style.setProperty('--life', `${DOZE.z.lifeS}s`)
          p.style.setProperty('--alpha', `${DOZE.z.alpha * 100}%`)
          p.addEventListener('animationend', () => p.remove())
          z.el.append(p)
        }
      }
    }
  }

  /** put a finished sentence in the screen-reader log (once per key; the DOM keeps the latest 20) */
  note(key: string, text: string) {
    if (!text || this.logged.has(key)) return
    this.logged.add(key)
    if (this.logged.size > 400) this.logged = new Set([...this.logged].slice(-100))
    const p = document.createElement('p')
    p.textContent = text
    this.log.append(p)
    while (this.log.children.length > LOG_KEEP) this.log.firstChild!.remove()
  }

  private make(b: BubbleItem): Live {
    const el = document.createElement('div')
    el.className = 'ob'
    el.dataset.agent = String(b.seat)
    el.dataset.kind = b.kind
    el.dataset.side = 'right'
    el.dataset.dir = 'up'
    const tabIcon = b.kind === 'react' ? iconSvg('heart') : ''
    el.innerHTML =
      '<i class="ob-lead"></i><i class="ob-dot"></i>' +
      `<div class="ob-card"><div class="ob-tab" aria-hidden="true">${tabIcon}${TAB[b.seat] ?? 'TEMP'} · ${esc(b.label)}</div>` +
      '<div class="ob-box"><div class="ob-body"><p class="ob-text" aria-hidden="true"></p></div></div></div>'
    const text = el.querySelector<HTMLElement>('.ob-text')!
    const chars = [...b.text]
    if (b.kind === 'private') text.innerHTML = `${iconSvg('lock')}${esc(b.text)}`
    else {
      text.innerHTML = '<span class="t"></span><b class="ob-caret">▌</b><span class="g"></span>'
      text.querySelector<HTMLElement>('.g')!.textContent = b.text
    }
    this.root.append(el)
    return {
      el,
      key: b.key,
      card: el.querySelector<HTMLElement>('.ob-card')!,
      typedEl: text.querySelector<HTMLElement>('.t') ?? text,
      ghostEl: text.querySelector<HTMLElement>('.g') ?? text,
      text,
      chars,
      typed: -1,
      w: 0,
      h: 0,
      measuredNarrow: null,
      open: '',
      style: '',
      leaving: false,
    }
  }

  private setTyped(l: Live, typed: number, kind: string) {
    if (kind === 'private' || typed === l.typed) return
    l.typed = typed
    l.typedEl.textContent = l.chars.slice(0, typed).join('')
    l.ghostEl.textContent = l.chars.slice(typed).join('')
    if (typed < l.chars.length) l.text.dataset.typing = ''
    else delete l.text.dataset.typing
  }

  private setOpen(l: Live, b: BubbleItem) {
    // only the bubble speaking now carries the link (a greyed past line would add a tab stop)
    const open = b.dim ? null : b.open
    const sig = open ? `${open.repo}#${open.n}/${open.row}` : ''
    if (sig === l.open) return
    l.open = sig
    l.el.querySelector('.ob-open')?.remove()
    if (!open) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ob-open'
    btn.textContent = '전문 보기'
    btn.setAttribute('aria-label', `전문 보기: #${open.n} 회의록, ${b.who.split('(')[0]}의 말`)
    const target = open
    btn.addEventListener('click', () => this.onOpen(target))
    l.el.querySelector('.ob-body')!.append(btn)
  }

  update(bubbles: BubbleItem[], tags: TagItem[], anchors: Record<string, Anchor>, view: LayerView) {
    const ids = new Set(bubbles.map((b) => b.id))
    // leaving: fade out, then remove
    for (const [id, l] of this.bubbles) {
      const gone = !ids.has(id)
      if (gone && !l.leaving) {
        l.leaving = true
        l.el.dataset.leaving = ''
        window.setTimeout(() => l.el.remove(), 160)
      }
      if (gone) this.bubbles.delete(id)
    }
    const inputs: PlaceInput[] = []
    for (const b of bubbles) {
      let l = this.bubbles.get(b.id)
      if (l && l.key !== b.key) {
        l.el.remove()
        l = undefined
      }
      if (!l) {
        l = this.make(b)
        this.bubbles.set(b.id, l)
      }
      this.setTyped(l, b.typed, b.kind)
      this.setOpen(l, b)
      if (b.typed >= l.chars.length) this.note(b.key, b.log)
      if (b.dim) l.el.setAttribute('data-dim', '')
      else l.el.removeAttribute('data-dim')
      if (l.measuredNarrow !== view.narrow) {
        l.measuredNarrow = view.narrow
        l.w = l.card.offsetWidth
        l.h = l.card.offsetHeight
      }
      const a = anchors[b.id]
      const other = b.pairWith ? anchors[b.pairWith] : undefined
      inputs.push({
        id: b.id,
        order: b.order,
        x: a?.x ?? -999,
        y: a?.y ?? -999,
        w: l.w,
        h: l.h,
        prefSide: a && other ? pairSide(a.x, other.x) : 'right',
        pair: !!(a && other),
        dim: b.dim,
      })
    }
    const placed = placeBubbles(inputs, view)
    for (const i of inputs) {
      const l = this.bubbles.get(i.id)!
      const p = placed[i.id]
      l.el.dataset.side = p.side
      l.el.dataset.dir = p.dir
      l.el.style.display = p.visible && anchors[i.id]?.visible ? '' : 'none'
      const style = `${Math.round(i.x)}|${Math.round(i.y)}|${p.stack}|${p.shift}`
      if (style !== l.style) {
        l.style = style
        l.el.style.setProperty('--x', `${Math.round(i.x)}px`)
        l.el.style.setProperty('--y', `${Math.round(i.y)}px`)
        l.el.style.setProperty('--stack', `${p.stack}px`)
        l.el.style.setProperty('--shift', `${p.shift}px`)
      }
    }
    this.updateTags(tags.filter((t) => !ids.has(t.id)), anchors)
  }

  private updateTags(tags: TagItem[], anchors: Record<string, Anchor>) {
    const want = new Set(tags.map((t) => t.id))
    for (const [id, t] of this.tags) {
      if (!want.has(id)) {
        t.el.remove()
        this.tags.delete(id)
      }
    }
    for (const t of tags) {
      let live = this.tags.get(t.id)
      const sig = `${t.icon}|${t.label}|${t.private}`
      if (!live || live.label !== sig) {
        live?.el.remove()
        const el = document.createElement('div')
        el.className = 'ot'
        el.dataset.agent = String(t.seat)
        if (t.private) el.dataset.kind = 'private'
        el.setAttribute('aria-hidden', 'true')
        el.innerHTML = `<div class="ot-chip">${iconSvg(t.icon)}<span>${esc(t.label)}</span></div>`
        this.root.append(el)
        live = { el, label: sig, style: '' }
        this.tags.set(t.id, live)
      }
      const a = anchors[t.id]
      live.el.style.display = a?.visible ? '' : 'none'
      const style = a ? `${Math.round(a.x)}|${Math.round(a.y)}` : ''
      if (a && style !== live.style) {
        live.style = style
        live.el.style.setProperty('--x', `${Math.round(a.x)}px`)
        live.el.style.setProperty('--y', `${Math.round(a.y)}px`)
      }
    }
  }
}
