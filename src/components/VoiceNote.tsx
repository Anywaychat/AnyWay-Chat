import { useEffect, useRef, useState } from 'react'
import { Captions, Pause, Play, Volume2 } from 'lucide-react'
import { transcribe } from '../transcribe'
import { translateForMe, type Translated } from '../translateMsg'
import { getLang, sayIn } from '../lang'

const BARS = 36
const SPEEDS = [1, 1.5, 2]
const peaksCache = new Map<string, Promise<number[]>>()

/** The voice message's loudness in BARS steps, for the waveform (worked out once per message). */
function peaksOf(src: string): Promise<number[]> {
  let p = peaksCache.get(src)
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(src)).arrayBuffer()
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const audio = await ctx.decodeAudioData(buf)
      void ctx.close()
      const data = audio.getChannelData(0)
      const step = Math.max(1, Math.floor(data.length / BARS))
      const out: number[] = []
      for (let i = 0; i < BARS; i++) {
        let max = 0
        for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) max = Math.max(max, Math.abs(data[j]))
        out.push(max)
      }
      const top = Math.max(...out, 0.01)
      return out.map((v) => Math.max(0.12, v / top))
    })().catch(() => Array.from({ length: BARS }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 1.7))))
    peaksCache.set(src, p)
  }
  return p
}
const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')

/**
 * A voice message like in any messenger: play, a waveform you can tap to jump, the time, and 1x / 1.5x / 2x.
 * Its words are written out on this device (automatically for deaf users) and translated into the reader's language,
 * with a button to hear the translation.
 */
export default function VoiceNote({ src, auto, label, mine = false }: { src: string; auto: boolean; label?: string; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle')
  const [text, setText] = useState('')
  const [tr, setTr] = useState<Translated | null>(null)

  useEffect(() => {
    let alive = true
    if (src) void peaksOf(src).then((p) => alive && setPeaks(p))
    return () => {
      alive = false
    }
  }, [src])

  const run = () => {
    setState('busy')
    transcribe(src)
      .then(async (t) => {
        setText(t || '(no words heard)')
        setState('done')
        if (t) setTr(await translateForMe(t))
      })
      .catch(() => setState('fail'))
  }
  useEffect(() => { if (auto && src) run() }, [auto, src]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current
    if (!a || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    a.currentTime = Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur))
  }
  const done = dur ? pos / dur : 0

  return (
    <div className={`vnote${mine ? ' mine' : ''}`}>
      <div className="vplayer">
        <button type="button" className="vplay" aria-label={playing ? 'Pause voice message' : `Play ${label ?? 'voice message'}`} onClick={toggle}>
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <div className="vwave" onClick={seek} aria-hidden="true">
          {(peaks.length ? peaks : Array.from({ length: BARS }, () => 0.15)).map((h, i) => (
            <i key={i} className={i / BARS < done ? 'on' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <span className="vtime">{clock(playing || pos ? pos : dur)}</span>
        <button
          type="button"
          className="vspeed"
          aria-label={`Playback speed ${speed} times. Change speed`}
          onClick={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
            setSpeed(next)
            if (audio.current) audio.current.playbackRate = next
          }}
        >
          {speed}×
        </button>
        <audio
          ref={audio}
          preload="metadata"
          src={src}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setPos(0)
          }}
        />
      </div>
      {state === 'idle' && <button type="button" className="link-btn" onClick={run}><Captions size={14} aria-hidden="true" /> Show words</button>}
      {state === 'busy' && <p className="vnote-text muted" role="status">Writing out the words…</p>}
      {state === 'done' && (
        <>
          <p className="vnote-text" dir="auto">“{tr && !tr.failed ? tr.text : text}”</p>
          {tr && !tr.failed && (
            <p className="vnote-orig" dir="auto">
              {tr.fromName ? `${tr.fromName}: ` : ''}“{text}”
            </p>
          )}
          {tr && !tr.failed && (
            <button type="button" className="link-btn" onClick={() => sayIn(tr.text, getLang())}><Volume2 size={14} aria-hidden="true" /> Hear it in my language</button>
          )}
        </>
      )}
      {state === 'fail' && <button type="button" className="link-btn" onClick={run}>Couldn't write it out. Try again</button>}
    </div>
  )
}
