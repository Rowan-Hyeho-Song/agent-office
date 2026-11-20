// #663 (hologram.md 1.2: no post-process bloom on the hologram) the office's bloom without the hologram board's light.
// The bloom's input is the scene less what the hologram adds: the hologram roots are drawn once more, alone, into a buffer the size of the
// scene's, and subtracted before the bloom's luminance pass. What shows on the screen is unchanged (the hologram is drawn as before); only the
// halo it raised round the board (its light, its stones over their glow, the events at 1.3 summed over 1.0) is gone. Every other neon blooms as
// before. Skipped while no hologram mesh is visible.
import { BloomEffect } from 'postprocessing'
import { Color, HalfFloatType, ShaderMaterial, WebGLRenderTarget, type Camera, type Mesh, type Object3D, type WebGLRenderer } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { bloomExcluded } from './bloomExclude'

/** whether a root has a mesh to draw (visible all the way down, with instances if instanced) */
export function drawsSomething(root: Object3D): boolean {
  if (!root.visible) return false
  let any = false
  root.traverseVisible((o) => {
    if (any || !(o as Mesh).isMesh) return
    const n = (o as Mesh & { count?: number }).count
    any = n === undefined || n > 0
  })
  return any
}

const LESS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`
const LESS_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tHolo;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tScene, vUv);
  gl_FragColor = vec4(max(s.rgb - texture2D(tHolo, vUv).rgb, 0.0), s.a);
}`

export class HoloFreeBloomEffect extends BloomEffect {
  /** false: the bloom as before, the hologram in it (?debug comparisons) */
  subtract = true
  private cam: Camera | null = null
  private readonly holoRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true })
  private readonly lessRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  private readonly less = new FullScreenQuad(
    new ShaderMaterial({ uniforms: { tScene: { value: null }, tHolo: { value: null } }, vertexShader: LESS_VERT, fragmentShader: LESS_FRAG, depthTest: false, depthWrite: false }),
  )
  private readonly prevColor = new Color()

  set mainCamera(camera: Camera) {
    this.cam = camera
  }

  update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number) {
    const roots = [...bloomExcluded].filter(drawsSomething)
    if (!this.subtract || !this.cam || !roots.length) {
      super.update(renderer, inputBuffer, deltaTime)
      return
    }
    const { width, height } = inputBuffer
    if (this.holoRT.width !== width || this.holoRT.height !== height) {
      this.holoRT.setSize(width, height)
      this.lessRT.setSize(width, height)
    }
    // the hologram alone, on black (linear, as the scene's buffer)
    const target = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    const prevColor = renderer.getClearColor(this.prevColor)
    const prevAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.holoRT)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.autoClear = false
    for (const root of roots) renderer.render(root, this.cam)
    // the scene less the hologram
    const m = this.less.material as ShaderMaterial
    m.uniforms.tScene.value = inputBuffer.texture
    m.uniforms.tHolo.value = this.holoRT.texture
    renderer.setRenderTarget(this.lessRT)
    this.less.render(renderer)
    renderer.setClearColor(prevColor, prevAlpha)
    renderer.autoClear = autoClear
    renderer.setRenderTarget(target)
    super.update(renderer, this.lessRT, deltaTime)
  }

  dispose() {
    this.holoRT.dispose()
    this.lessRT.dispose()
    this.less.dispose()
    ;(this.less.material as ShaderMaterial).dispose()
    super.dispose()
  }
}
