import { useEffect, useReducer, useState, useSyncExternalStore } from 'react'
import { PERIODS } from '../office/outside'
import { passCar, setAmbienceOverride, startAmbience } from './ambience'
import { CUES, CUE_NAMES, cue, cueCounts, type CueName } from './cues'
import { BUS_LEVEL, audioDebug, audioGraph, ensureAudio, getBusLevel, meter, setBusLevel, testTone, type Bus, type Vec } from './engine'
import { silenceReasons } from './audible'
import { measureCue, type Level } from './levels'
import { LAYERS, TEMPOS, getMusicState, getTempo, isLayerMuted, setMusicState, setTempo, toggleLayer, type MusicState, type Tempo } from './music'
import { getSetting, setSetting, subscribe } from './settings'
import { midi, tone } from './synth'

// ?debug=1 sound panel (docs/design/sound.md 8.1): where the user listens and judges, since the session can't hear.
// Top to bottom (designer): meter → master → buses → position → cues (good / loud / quiet + a copy line) → room tone
// → speaker music → desk room comparison.

type Verdict = '좋음' | '크다' | '작다'
type Where = 'near' | 'far' | 'left' | 'right'
const WHERE: Record<Where, string> = { near: '가까이', far: '멀리', left: '왼쪽', right: '오른쪽' }
const BUSES: Bus[] = ['music', 'sfx', 'voice', 'ambience']
const PERIOD_NAMES = ['새벽', '낮', '저녁', '밤']
const STATE_NAMES: Record<MusicState, string> = { off: '끔', work: '일할 때 (−12 dB)', break: '쉴 때' }

/** a point relative to the listener (the camera) */
function placeOf(w: Where): Vec | undefined {
  const g = audioGraph()
  if (!g) return undefined
  const l = g.ctx.listener
  const p = { x: l.positionX?.value ?? 0, y: l.positionY?.value ?? 0, z: l.positionZ?.value ?? 0 }
  const f = { x: l.forwardX?.value ?? 0, y: 0, z: l.forwardZ?.value ?? -1 }
  const n = Math.hypot(f.x, f.z) || 1
  f.x /= n
  f.z /= n
  const r = { x: -f.z, z: f.x } // right of forward on the floor
  const at = (fwd: number, side: number) => ({ x: p.x + f.x * fwd + r.x * side, y: p.y - 0.5, z: p.z + f.z * fwd + r.z * side })
  // 가까이 = the room seen from the default view (~15 m, full level); 멀리 = twice as far; 왼쪽/오른쪽 = the room's sides
  return w === 'near' ? at(15, 0) : w === 'far' ? at(30, 0) : w === 'left' ? at(15, -6) : at(15, 6)
}

const fmt = (v: number) => (v <= -119 ? '−∞' : v.toFixed(1))

export function SoundDebug() {
  const s = useSyncExternalStore(subscribe, getSetting)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const [where, setWhere] = useState<Where>('near')
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({})
  const [levels, setLevels] = useState<Partial<Record<CueName, Level>>>({})
  const [m, setM] = useState<{ peak: number; rms: number } | null>(null)
  const [avg, setAvg] = useState(-120)

  useEffect(() => {
    let acc: number[] = []
    const id = setInterval(() => {
      const v = meter()
      setM(v)
      if (v) {
        acc = [...acc.slice(-11), v.rms] // 3 s at 4 Hz
        const p = acc.reduce((a, x) => a + Math.pow(10, x / 10), 0) / acc.length
        setAvg(10 * Math.log10(Math.max(1e-12, p)))
      }
    }, 250)
    return () => clearInterval(id)
  }, [])

  // debug only: lets level-check scripts drive the mix (like the desk room's window.__audio)
  useEffect(() => {
    ;(window as unknown as { __sound: unknown }).__sound = { audioGraph, ensureAudio, setBusLevel, getBusLevel, cue, cueCounts, setMusicState, startAmbience, setAmbienceOverride, meter, setSetting }
  }, [])

  const [tonePeak, setTonePeak] = useState<number | null>(null)
  const playTest = () => {
    start()
    testTone()
    let best = -120
    const id = setInterval(() => (best = Math.max(best, meter()?.peak ?? -120)), 40)
    setTimeout(() => {
      clearInterval(id)
      setTonePeak(best)
    }, 900)
  }
  const dbg = audioDebug()
  const reasons = silenceReasons({ muted: s.muted, volume: s.volume, ctx: dbg.ctx, hidden: document.hidden, room: dbg.room })

  const start = () => {
    // a stored volume of 0 would keep "소리 켜기" silent: turning it on brings the volume back
    if (getSetting().muted || getSetting().volume <= 0.001) setSetting({ muted: false, volume: getSetting().volume <= 0.001 ? 1 : getSetting().volume })
    ensureAudio()
    startAmbience()
    tick()
  }
  const play = (name: CueName) => {
    start()
    cue(name, { pos: placeOf(where), agent: name === 'voice' ? 'agent_4' : undefined, dur: 2 })
  }
  const judge = (key: string, v: Verdict) => setVerdicts((o) => ({ ...o, [key]: v }))
  const copyLine = Object.entries(verdicts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const measureAll = async () => {
    const out: Partial<Record<CueName, Level>> = {}
    for (const n of CUE_NAMES) out[n] = await measureCue(n)
    setLevels(out)
  }
  // the desk room's own success and click at its levels (sfx bus 0.55), for a side-by-side
  const deskSuccess = () => {
    start()
    const g = audioGraph()
    if (!g) return
    const trim = g.ctx.createGain()
    trim.gain.value = 0.55 / getBusLevel('sfx')
    trim.connect(g.bus.sfx)
    ;[0, 4, 7, 12].forEach((st, i) => tone({ c: g.ctx, dest: trim, echo: g.echo, t: g.ctx.currentTime }, midi(72 + st), 0.18, { level: 0.05, at: i * 0.08, echo: true }))
  }
  const deskClick = () => {
    start()
    const g = audioGraph()
    if (!g) return
    const trim = g.ctx.createGain()
    trim.gain.value = 0.55 / getBusLevel('sfx')
    trim.connect(g.bus.sfx)
    tone({ c: g.ctx, dest: trim, t: g.ctx.currentTime }, 900, 0.05, { type: 'square', level: 0.04, slide: 1.6 })
  }

  return (
    <details className="sound-debug">
      <summary>소리 (#194)</summary>
      <p className="sd-note">세션은 소리를 들을 수 없어요. 들어 보고 판정을 누른 뒤, 맨 아래 줄을 복사해 #194에 붙여 주세요.</p>

      <section aria-label="지금 소리가 안 나는 이유" className="sd-why" role="status">
        <b>지금 상태</b>{' '}
        {reasons.length === 0 ? (
          <span className="sd-ok">페이지는 소리를 내는 중이에요.</span>
        ) : (
          <ul>
            {reasons.map((r) => (
              <li key={r.code}>
                {r.text}{' '}
                {r.fix === '다시 시작' ? (
                  <button type="button" onClick={() => void audioGraph()?.ctx.resume().then(tick)}>
                    다시 시작
                  </button>
                ) : r.fix === '음량 100%' ? (
                  <button type="button" onClick={() => setSetting({ volume: 1 })}>
                    음량 100%
                  </button>
                ) : r.fix ? (
                  <button type="button" onClick={start}>
                    {r.fix}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div>
          <button type="button" onClick={playTest}>
            테스트 소리 (440 Hz, 0.8초)
          </button>{' '}
          {tonePeak !== null &&
            (tonePeak > -60 ? (
              <span>
                페이지에서 소리가 나갔어요(피크 {fmt(tonePeak)} dBFS). 그래도 안 들리면 <b>탭 음소거 · 출력 장치 · 시스템 볼륨</b>을 확인하세요.
              </span>
            ) : (
              <span>페이지에서 소리가 나가지 않았어요. 위의 이유를 먼저 풀어 주세요.</span>
            ))}
        </div>
        <small>
          출력 장치: {dbg.sink === undefined ? '브라우저가 알려 주지 않음' : dbg.sink === '' ? '시스템 기본' : dbg.sink}
        </small>
      </section>

      <section aria-label="미터">
        <b>미터</b> 피크 {m ? fmt(m.peak) : '—'} dBFS · 3초 평균 {fmt(avg)} dBFS · {audioGraph()?.ctx.state ?? '아직 없음'}
      </section>

      <section aria-label="master">
        <b>master</b>{' '}
        <button type="button" onClick={() => (s.muted ? start() : setSetting({ muted: true }))}>
          {s.muted ? '소리 켜기' : '소리 끄기'}
        </button>{' '}
        <input type="range" min={0} max={100} value={Math.round(s.volume * 100)} onChange={(e) => setSetting({ volume: Number(e.target.value) / 100 })} aria-label="음량" />{' '}
        {Math.round(s.volume * 100)}%
      </section>

      <section aria-label="버스">
        {BUSES.map((b) => (
          <label key={b} className="sd-row">
            <span>{b}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(getBusLevel(b) * 100)}
              onChange={(e) => {
                setBusLevel(b, Number(e.target.value) / 100)
                tick()
              }}
            />
            <span>
              {getBusLevel(b).toFixed(2)} <small>(기준 {BUS_LEVEL[b]})</small>
            </span>
          </label>
        ))}
      </section>

      <fieldset>
        <legend>위치 (3D 효과음)</legend>
        {(Object.keys(WHERE) as Where[]).map((w) => (
          <label key={w}>
            <input type="radio" name="sd-where" checked={where === w} onChange={() => setWhere(w)} /> {WHERE[w]}
          </label>
        ))}
      </fieldset>

      <section aria-label="효과음">
        <div className="sd-head">
          <b>효과음</b> <button type="button" onClick={() => void measureAll()}>전부 재기</button>
        </div>
        <ol className="sd-cues">
          {CUE_NAMES.map((n) => (
            <li key={n}>
              <button type="button" onClick={() => play(n)} aria-label={`${CUES[n].label} 듣기`}>
                ▶
              </button>
              <span className="sd-name">
                {CUES[n].label} <code>{n}</code>
              </span>
              {levels[n] && (
                <small>
                  {fmt(levels[n]!.peak)} dBFS · {fmt(levels[n]!.lufs)} LUFS
                </small>
              )}
              <span className="sd-judge">
                {(['좋음', '크다', '작다'] as Verdict[]).map((v) => (
                  <button type="button" key={v} aria-pressed={verdicts[n] === v} onClick={() => judge(n, v)}>
                    {v}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="공간음">
        <b>공간음</b>{' '}
        {PERIODS.map((p, i) => (
          <button
            type="button"
            key={i}
            onClick={() => {
              start()
              setAmbienceOverride(p.from + 30)
            }}
          >
            {PERIOD_NAMES[i]}
          </button>
        ))}{' '}
        <button type="button" onClick={() => setAmbienceOverride(null)}>
          시계 따라감
        </button>{' '}
        <button
          type="button"
          onClick={() => {
            start()
            passCar()
          }}
        >
          차 지나감
        </button>
      </section>

      <section aria-label="스피커 음악">
        <b>스피커 음악</b>
        <p className="sd-note">아직 에이전트 상태와 이어지지 않았어요(③). 여기서 "쉴 때"를 누르면 쉬는 시간 음악, "일할 때"를 누르면 작게 깔리는 음악을 들을 수 있어요.</p>{' '}
        {(Object.keys(STATE_NAMES) as MusicState[]).map((st) => (
          <button
            type="button"
            key={st}
            aria-pressed={getMusicState() === st}
            onClick={() => {
              start()
              setMusicState(st)
              tick()
            }}
          >
            {STATE_NAMES[st]}
          </button>
        ))}
        <div>
          템포{' '}
          {TEMPOS.map((t: Tempo) => (
            <button
              type="button"
              key={t}
              aria-pressed={getTempo() === t}
              onClick={() => {
                setTempo(t)
                tick()
              }}
            >
              {t}
            </button>
          ))}{' '}
          <button type="button" onClick={() => judge(`music.tempo`, '좋음')}>
            이 템포 좋음
          </button>
        </div>
        <div className="sd-layers">
          {LAYERS.map((l) => (
            <label key={l}>
              <input
                type="checkbox"
                checked={!isLayerMuted(l)}
                onChange={(e) => {
                  toggleLayer(l, e.target.checked)
                  tick()
                }}
              />{' '}
              {l}
            </label>
          ))}
          <small> (층은 2마디 경계에서 바뀜)</small>
        </div>
      </section>

      <section aria-label="책상 방과 비교">
        <b>책상 방과 비교</b> <button type="button" onClick={deskClick}>책상 클릭</button>
        <button type="button" onClick={() => play('ui.click')}>사무실 클릭</button>
        <button type="button" onClick={deskSuccess}>책상 성공</button>
        <button type="button" onClick={() => play('approve')}>사무실 승인</button>
      </section>

      <section aria-label="복사 줄">
        <b>복사 줄</b>
        <input
          readOnly
          value={copyLine.replace('music.tempo=좋음', `music.tempo=${getTempo()}`)}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="판정 줄 (복사해서 이슈에 붙이기)"
        />
        <button type="button" onClick={() => void navigator.clipboard?.writeText(copyLine.replace('music.tempo=좋음', `music.tempo=${getTempo()}`))}>
          복사
        </button>
      </section>
    </details>
  )
}
