// "Why can't I hear anything?" (#194 audible fix): the reasons the page itself can be silent, in the order to check them.
// The ?debug sound panel shows them at the top, and a test tone tells the page's own output apart from the tab/device.

export type Silence = { code: 'muted' | 'volume0' | 'noContext' | 'suspended' | 'closed' | 'hidden' | 'room0'; text: string; fix?: string }

export type AudibleState = {
  muted: boolean
  volume: number
  /** null = no AudioContext yet */
  ctx: AudioContextState | null
  hidden: boolean
  /** the room crossfade gain (0 while leaving the office) */
  room: number | null
}

/** every reason this page is silent right now (pure, tested); empty = the page is sounding */
export function silenceReasons(s: AudibleState): Silence[] {
  const out: Silence[] = []
  if (s.muted) out.push({ code: 'muted', text: '음소거 상태예요.', fix: '소리 켜기' })
  if (s.volume <= 0.001) out.push({ code: 'volume0', text: '음량이 0%예요.', fix: '음량 100%' })
  if (s.ctx === null) out.push({ code: 'noContext', text: '아직 소리가 시작되지 않았어요. 소리 켜기를 누르거나 화면을 한 번 누르세요.', fix: '소리 켜기' })
  else if (s.ctx === 'suspended' || s.ctx === 'interrupted') out.push({ code: 'suspended', text: '브라우저가 소리를 멈춰 두었어요(자동 재생 막힘 또는 탭 전환).', fix: '다시 시작' })
  else if (s.ctx === 'closed') out.push({ code: 'closed', text: '소리 장치가 닫혔어요. 페이지를 새로 고쳐 주세요.' })
  if (s.hidden) out.push({ code: 'hidden', text: '탭이 숨겨져 있어 소리를 멈췄어요.' })
  if (s.room !== null && s.room < 0.01) out.push({ code: 'room0', text: '방을 나가는 중이라 사무실 소리를 내렸어요.' })
  return out
}
