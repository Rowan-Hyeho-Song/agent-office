import { useEffect, useReducer, useState, useSyncExternalStore } from 'react'
import { PERIODS } from '../office/outside'
import { passCar, setAmbienceOverride, startAmbience } from './ambience'
import { CUES, CUE_NAMES, cue, cueCounts, type CueName } from './cues'
import { BUS_LEVEL, audioDebug, audioGraph, ensureAudio, getBusLevel, meter, setBusLevel, testTone, type Bus, type Vec } from './engine'
import { silenceReasons } from './audible'
import { measureCue, type Level } from './levels'
import { LAYERS, TEMPOS, getMusicState, getTempo, isLayerMuted, setMusicState, setTempo, toggleLayer, type MusicState, type Tempo } from './music'
import { getSetting, setSetting, subscribe } from './settings'
import { faderLevels, forceMusic, forcedMusic, getMusicDist, setMusicDist, speakerCells, speakerCone, speakerForMe, toggleSpeakerForMe, type MusicDist } from './speaker'
import { midi, tone } from './synth'
import { KEY_VOICES, KEY_VOICE_LABEL, getKeyVoice, loadKeySample, setKeyVoice, type KeyKind, type KeyVoice } from './keys'
import { keysBetween } from './typing'

// ?debug=1 sound panel (docs/design/sound.md 8.1): where the user listens and judges, since the session can't hear.
// Top to bottom (designer): meter → master → buses → position → cues (good / loud / quiet + a copy line) → room tone
// → speaker music → desk room comparison.

type Verdict = '좋음' | '크다' | '작다'
type Where = 'near' | 'far' | 'left' | 'right'
const WHERE: Record<Where, string> = { near: '가까이', far: '멀리', left: '왼쪽', right: '오른쪽' }
const BUSES: Bus[] = ['music', 'sfx', 'keys', 'voice', 'ambience']
const PERIOD_NAMES = ['새벽', '낮', '저녁', '밤']
const STATE_NAMES: Record<MusicState, string> = { off: '끔', work: '일할 때 (−12 dB)', break: '쉴 때' }
const DIST_NAMES: Record<MusicDist, string> = { room: '방 어디서나 같게', near: '가까이 크게 · 멀리 작게' }

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
    ;(window as unknown as { __sound: unknown }).__sound = { audioGraph, ensureAudio, setBusLevel, getBusLevel, cue, cueCounts, setMusicState, forceMusic, setMusicDist, startAmbience, setAmbienceOverride, meter, setSetting }
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
  // bus faders move in dB around the defaults; any change goes into the copy line so a "louder/quieter" comes back as numbers
  const busDb = (b: Bus) => Math.round(20 * Math.log10(Math.max(1e-6, getBusLevel(b) / BUS_LEVEL[b])))
  const busLine = BUSES.filter((b) => busDb(b) !== 0).map((b) => `bus.${b}=${busDb(b) > 0 ? '+' : ''}${busDb(b)}dB`)
  const copyLine = [...Object.entries(verdicts).map(([k, v]) => `${k}=${v}`), ...busLine, `keys.voice=${getKeyVoice()}`, `music.dist=${getMusicDist()}`].join(' ')
  // keyboard demo: one agent typing a few seconds with the live rhythm, or several at once, or one special key
  const typeDemo = (typists: number, seconds = 4, offset = 0) => {
    start()
    const g = audioGraph()
    if (!g) return
    for (let a = 0; a < typists; a++) {
      // start typing at once, and step through in small slices (a jump over 1 s is a fresh start with no keys)
      let s = { ...keysBetween(null, 0).next, next: 0.05 + a * 0.07, burstEnd: seconds }
      for (let t = 0.05; t <= seconds; t += 0.05) {
        const r = keysBetween(s, t)
        r.keys.forEach((k, i) => cue('type', { agent: `agent_${a}`, at: offset + k, keyKind: r.kinds[i] }))
        s = r.next
      }
    }
  }
  // #194 A/B: the same typing, 3 s each, 녹음 (the sound) → 합성 도각 (its fallback), with the name of the one sounding
  const [abNow, setAbNow] = useState<string | null>(null)
  const abCompare = async () => {
    start()
    const g = audioGraph()
    if (!g) return
    await loadKeySample(g.ctx)
    const keep = getKeyVoice()
    const order: KeyVoice[] = ['sample', 'thock2']
    order.forEach((v, i) => {
      setKeyVoice(v) // cue() reads the voice when it schedules, so each 3 s slot keeps its own
      typeDemo(1, 3, i * 3.5)
      setTimeout(() => setAbNow(KEY_VOICE_LABEL[v]), i * 3500)
    })
    setTimeout(() => setAbNow(null), order.length * 3500)
    setKeyVoice(keep)
  }
  const oneKey = (k: KeyKind) => {
    start()
    cue('type', { agent: 'agent_3', keyKind: k })
  }
  // #225 mouse: a click is down then up ~90 ms later; a scroll is notches 120–170 ms apart (the input bus's timing)
  const mouseDemo = (what: 'click' | 'scroll') => {
    start()
    if (what === 'click') {
      cue('mouse.down', { agent: 'agent_3' })
      cue('mouse.up', { agent: 'agent_3', at: 0.09 })
    } else for (let i = 0, t = 0; i < 6; i++, t += 0.12 + Math.random() * 0.05) cue('mouse.wheel', { agent: 'agent_3', at: t })
  }
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
              min={-12}
              max={12}
              step={1}
              value={busDb(b)}
              aria-valuetext={`${busDb(b)} dB`}
              onChange={(e) => {
                setBusLevel(b, BUS_LEVEL[b] * Math.pow(10, Number(e.target.value) / 20))
                tick()
              }}
            />
            <span>
              {busDb(b) > 0 ? '+' : ''}
              {busDb(b)} dB <small>({getBusLevel(b).toFixed(3)})</small>
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

      <section aria-label="키보드 소리">
        <b>키보드 소리</b>
        <div>
          {KEY_VOICES.map((v) => (
            <label key={v} style={{ marginRight: 8 }}>
              <input
                type="radio"
                name="sd-keys"
                checked={getKeyVoice() === v}
                onChange={() => {
                  setKeyVoice(v)
                  tick()
                }}
              />{' '}
              {KEY_VOICE_LABEL[v]}
            </label>
          ))}
        </div>
        <div>
          <button type="button" onClick={() => typeDemo(1)}>
            한 명 4초 치기
          </button>
          <button type="button" onClick={() => typeDemo(5)}>
            다섯 명 동시에
          </button>{' '}
          <button type="button" onClick={() => oneKey('char')}>
            키
          </button>
          <button type="button" onClick={() => oneKey('space')}>
            스페이스
          </button>
          <button type="button" onClick={() => oneKey('enter')}>
            엔터
          </button>
          <button type="button" onClick={() => oneKey('backspace')}>
            백스페이스
          </button>{' '}
          <button type="button" onClick={() => mouseDemo('click')}>
            마우스 클릭
          </button>
          <button type="button" onClick={() => mouseDemo('scroll')}>
            휠 여섯 칸
          </button>
        </div>
        <div>
          <button type="button" onClick={() => void abCompare()}>
            연달아 비교 (녹음 → 합성, 3초씩)
          </button>{' '}
          <span aria-live="polite">{abNow ? `지금: ${abNow}` : ''}</span>
        </div>
        <small>
          고른 소리와 위 keys 버스 크기가 맨 아래 복사 줄에 들어가요. 키 소리는 실제 키보드 녹음(Rainy 75, CC0, 61 KB)이고, 합성 도각은 파일이 오기 전에 대신
          나요.
        </small>
      </section>

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
        <p className="sd-note">
          에코 책상 스피커에서 나요. 에이전트 둘 이상이 쉬면 "쉴 때", 아니면 "일할 때", 밤에는 꺼져요(8초 지켜본 뒤 바뀜). 탁구 중에는 4 dB 낮아져요. 아래 버튼은 상태를 고정해 들어 보는
          것이고, "에이전트 따라"로 돌아가요.
        </p>{' '}
        <button
          type="button"
          aria-pressed={forcedMusic() === null}
          onClick={() => {
            start()
            forceMusic(null)
            tick()
          }}
        >
          에이전트 따라 ({STATE_NAMES[getMusicState()]})
        </button>
        {(Object.keys(STATE_NAMES) as MusicState[]).map((st) => (
          <button
            type="button"
            key={st}
            aria-pressed={forcedMusic() === st}
            onClick={() => {
              start()
              forceMusic(st)
              tick()
            }}
          >
            {STATE_NAMES[st]}
          </button>
        ))}
        <div>
          거리{' '}
          {(Object.keys(DIST_NAMES) as MusicDist[]).map((d) => (
            <button
              type="button"
              key={d}
              aria-pressed={getMusicDist() === d}
              onClick={() => {
                setMusicDist(d)
                tick()
              }}
            >
              {DIST_NAMES[d]}
            </button>
          ))}{' '}
          <button
            type="button"
            onClick={() => {
              start()
              toggleSpeakerForMe()
              tick()
            }}
          >
            스피커 누르기 ({speakerForMe() ? '켜짐' : '나에게만 꺼짐'})
          </button>
          <small>
            {' '}
            미터 {speakerCells()}/8 · 콘 {speakerCone().toFixed(2)} · 페이더 {faderLevels().map((v) => v.toFixed(2)).join(' ')}
          </small>
        </div>
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
