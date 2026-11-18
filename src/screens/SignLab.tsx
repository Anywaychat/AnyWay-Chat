import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Shuffle } from 'lucide-react'
import { isSure, loadSignReader, setSignBoost, SignReader, topWords, type Guess, type Pt, type Segment } from '../sign'
import { loadSigns, type SignWord } from '../signs'
import SignClip from '../components/SignClip'
import { readSession } from '../state'

/**
 * Sign lab: a test bench for the sign reader. Pick a word, sign it, and see exactly what the reader saw and guessed.
 * Each attempt (its tracked points, the model's guesses and a short video) is saved on this computer only, in
 * data/signlab, so misreadings can be replayed and studied. Saving is refused on the live site.
 */
const STARTERS = ['hello', 'thankyou', 'goodmorning', 'howareyou', 'good', 'bad', 'happy', 'sad', 'nice', 'alright', 'friend', 'mother', 'father', 'doctor', 'house', 'school', 'today', 'tomorrow', 'i', 'you', 'we', 'beautiful', 'hot', 'cold', 'sick', 'money']

type Attempt = { id: string; target: string; guesses: Guess[]; raw: Guess[]; sure: boolean; ms: number; frames: number; handsPct: number; posePct: number; skipped?: string; saved: 'saving' | 'saved' | 'local only' }
type Live = { fps: number; hands: number; pose: boolean; hint: string }

const r4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)

export default function SignLab() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [words, setWords] = useState<SignWord[]>([])
  const [at, setAt] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Starting the camera and the sign reader…')
  const [live, setLive] = useState<Live>({ fps: 0, hands: 0, pose: false, hint: '' })
  const [reading, setReading] = useState(false)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [copied, setCopied] = useState(false)
  const target = words[at]
  const targetRef = useRef<SignWord | undefined>(undefined)
  useEffect(() => {
    targetRef.current = target
  })

  // Only the words the reader knows, everyday ones first.
  useEffect(() => {
    void Promise.all([loadSigns(), fetch('/models/isl_vocab.json').then((r) => r.json() as Promise<string[]>)]).then(([all, vocab]) => {
      const known = all.filter((w) => vocab.includes(w.id))
      const first = STARTERS.map((id) => known.find((w) => w.id === id)).filter((w): w is SignWord => !!w)
      setWords([...first, ...known.filter((w) => !first.includes(w)).sort((a, b) => a.name.localeCompare(b.name))])
    })
  }, [])

  useEffect(() => {
    let reader: SignReader | null = null
    let stream: MediaStream | null = null
    let alive = true
    let recorder: { rec: MediaRecorder; id: string } | null = null
    let segId = ''
    let wasRecording = false
    let frameCount = 0
    let lastFps = performance.now()
    let lastLive = 0
    // Plain model output here: no boost for "words that fit the conversation".
    setSignBoost([])

    const upload = (path: string, id: string, body: BodyInit, type: string) =>
      fetch(`/api/${path}?id=${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${readSession() ?? ''}` }, body }).then((r) => r.ok)

    const draw = (pts: Pt[]) => {
      const c = canvas.current
      const v = video.current
      if (!c || !v) return
      const w = (c.width = v.clientWidth)
      const h = (c.height = v.clientHeight)
      const g = c.getContext('2d')!
      g.clearRect(0, 0, w, h)
      pts.forEach(([x, y], i) => {
        if (!Number.isFinite(x)) return
        g.fillStyle = i < 25 ? 'rgba(255,255,255,.85)' : i < 46 ? '#FF5A4E' : '#4EA1FF'
        g.beginPath()
        g.arc(x * w, y * h, i < 25 ? 3 : 2.5, 0, Math.PI * 2)
        g.fill()
      })
    }

    const onFrame = (pts: Pt[], hands: number, pose: boolean) => {
      draw(pts)
      frameCount++
      const now = performance.now()
      if (now - lastLive < 250) return
      lastLive = now
      const fps = (frameCount * 1000) / (now - lastFps)
      if (now - lastFps > 2000) {
        frameCount = 0
        lastFps = now
      }
      // Framing hints from the shoulders (body points 11 and 12) and the hands' positions.
      let hint = ''
      const [l, r] = [pts[11], pts[12]]
      if (!pose) hint = 'Make sure your head and shoulders are in the picture.'
      else if (Number.isFinite(l[0]) && Number.isFinite(r[0])) {
        const span = Math.abs(l[0] - r[0])
        if (span > 0.55) hint = 'Move back a little: your shoulders fill most of the picture, so raised hands go out of view.'
        else if (span < 0.15) hint = 'Come a bit closer: you look small in the picture.'
      }
      const handPts = pts.slice(25).filter(([x]) => Number.isFinite(x))
      if (!hint && handPts.some(([x, y]) => x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98)) hint = 'A hand is at the edge of the picture.'
      setLive({ fps: Math.round(fps), hands, pose, hint })
    }

    const onState = ({ recording }: { hands: boolean; recording: boolean }) => {
      setReading(recording)
      if (recording && !wasRecording) {
        segId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${targetRef.current?.id ?? 'none'}`
        if (stream && typeof MediaRecorder !== 'undefined') {
          const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
          const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 900_000 })
          const chunks: Blob[] = []
          const id = segId
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
          rec.onstop = () => void upload('signlab/video', id, new Blob(chunks, { type: rec.mimeType }), rec.mimeType || 'video/webm').catch(() => false)
          rec.start(250)
          recorder = { rec, id }
        }
      }
      if (!recording && wasRecording && recorder) {
        recorder.rec.stop()
        recorder = null
      }
      wasRecording = recording
    }

    const onSegment = async (s: Segment) => {
      const id = segId || `${Date.now()}-none`
      const t = targetRef.current
      const frames = s.frames
      const ms = frames.length ? frames[frames.length - 1].t - frames[0].t : 0
      const seen = (from: number, to: number) => frames.filter((f) => f.pts.slice(from, to).some(([x]) => Number.isFinite(x))).length / Math.max(1, frames.length)
      const raw = s.skipped ? [] : await topWords(frames, s.aspect, 5)
      const a: Attempt = { id, target: t?.id ?? '', guesses: s.guesses, raw, sure: isSure(s.guesses), ms, frames: frames.length, handsPct: Math.round(seen(25, 67) * 100), posePct: Math.round(seen(0, 25) * 100), skipped: s.skipped, saved: 'saving' }
      setAttempts((l) => [a, ...l])
      const v = video.current
      const ok = await upload(
        'signlab',
        id,
        JSON.stringify({ id, target: a.target, guesses: s.guesses, raw, sure: a.sure, skipped: s.skipped ?? null, aspect: s.aspect, ms, camera: v ? [v.videoWidth, v.videoHeight] : null, userAgent: navigator.userAgent, frames: frames.map((f) => ({ t: Math.round(f.t), pts: f.pts.map(([x, y]) => [r4(x), r4(y)]) })) }),
        'application/json',
      ).catch(() => false)
      setAttempts((l) => l.map((x) => (x.id === id ? { ...x, saved: ok ? 'saved' : 'local only' } : x)))
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
        if (!alive) return stream.getTracks().forEach((t) => t.stop())
        const v = video.current!
        v.srcObject = stream
        await v.play()
        // The picture keeps the camera's own shape (some give 16:9), so the tracking dots line up.
        if (v.videoWidth && v.videoHeight) v.parentElement?.style.setProperty('aspect-ratio', `${v.videoWidth} / ${v.videoHeight}`)
        setStatus('Loading the sign reader…')
        await loadSignReader()
        if (!alive) return
        reader = new SignReader(v, () => {}, onState, { onSegment: (s) => void onSegment(s), onFrame })
        await reader.start()
        setStatus('')
      } catch (e) {
        setStatus((e as Error).name === 'NotAllowedError' ? 'Allow the camera for this site to use the Sign lab.' : `The sign reader could not start: ${(e as Error).message}`)
      }
    })()
    return () => {
      alive = false
      reader?.stop()
      recorder?.rec.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const done = attempts.filter((a) => !a.skipped)
  const right = done.filter((a) => a.guesses[0]?.word === a.target).length
  const top3 = done.filter((a) => a.raw.slice(0, 3).some((g) => g.word === a.target)).length
  const asked = done.filter((a) => !a.sure).length
  const name = (id: string) => words.find((w) => w.id === id)?.name ?? id
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const verdict = (a: Attempt) => (a.skipped ? 'Skipped' : a.guesses[0]?.word === a.target ? 'Right' : a.raw.slice(0, 3).some((g) => g.word === a.target) ? 'In top 3' : 'Wrong')
  const matches = query.trim() ? words.filter((w) => w.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : []

  const copy = async () => {
    const lines = attempts
      .slice()
      .reverse()
      .map((a) => `${name(a.target)} → ${a.skipped ? a.skipped : `${name(a.guesses[0]?.word ?? '')} (${pct(a.guesses[0]?.score ?? 0)})${a.sure ? '' : ' asked'} | model: ${a.raw.slice(0, 3).map((g) => `${name(g.word)} ${pct(g.score)}`).join(', ')} | ${verdict(a)}`} | ${(a.ms / 1000).toFixed(1)} s, ${a.frames} frames, hands ${a.handsPct}%`)
    const text = `Sign lab: ${right}/${done.length} right, ${top3}/${done.length} in top 3, ${asked} asked\n${lines.join('\n')}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn back-btn" style={{ display: 'grid' }} aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <div className="topbar-title"><h1 className="topbar-name">Sign lab</h1><span>Test the sign reader, one word at a time</span></div>
      </header>
      <div className="scroll lab">
        <section className="lab-target" aria-label="Word to sign">
          <div className="lab-word">
            <span className="muted">Sign this word</span>
            <strong>{target?.name ?? '…'}</strong>
            <div className="lab-nav">
              <button className="btn" aria-label="Previous word" onClick={() => setAt((i) => Math.max(0, i - 1))}><ChevronLeft size={16} aria-hidden="true" /></button>
              <button className="btn" aria-label="Next word" onClick={() => setAt((i) => Math.min(words.length - 1, i + 1))}><ChevronRight size={16} aria-hidden="true" /></button>
              <button className="btn" onClick={() => setAt(Math.floor(Math.random() * words.length))}><Shuffle size={16} aria-hidden="true" />Random</button>
            </div>
            <input className="input" placeholder="Find a word (262 known)" aria-label="Find a word" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <div className="lab-matches">
                {matches.map((w) => <button key={w.id} className="chip-btn" onClick={() => { setAt(words.indexOf(w)); setQuery('') }}>{w.name}</button>)}
              </div>
            )}
          </div>
          {target && <div className="lab-ref" aria-label={`How ${target.name} is signed`}><SignClip key={target.id} ids={[target.id]} loop /><small>How it's signed (copy this)</small></div>}
        </section>

        <section className="lab-cam">
          <div className="lab-video">
            <video ref={video} playsInline muted />
            <canvas ref={canvas} aria-hidden="true" />
            <span className={`lab-rec${reading ? ' on' : ''}`}>{reading ? 'Reading your sign…' : 'Raise your hands to sign'}</span>
          </div>
          <p className="lab-live" role="status">
            {status || `${live.fps} frames/s · hands: ${live.hands} · body: ${live.pose ? 'yes' : 'no'}`}
            {live.hint && <b> · {live.hint}</b>}
          </p>
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Sign once, then lower your hands for a second. Dots: white = body, red and blue = your two hands. If the dots don't follow your fingers, the reader can't see them.</p>
        </section>

        <section className="lab-results">
          <div className="row-between">
            <h2>Attempts</h2>
            <button className="btn" onClick={() => void copy()} disabled={!attempts.length}><Copy size={16} aria-hidden="true" />{copied ? 'Copied' : 'Copy results'}</button>
          </div>
          <p className="lab-sum">{done.length ? `${right} of ${done.length} right · ${top3} in the top 3 · asked "Did you sign…?" ${asked} times` : 'No attempts yet.'}{attempts.length - done.length ? ` · ${attempts.length - done.length} too short` : ''}</p>
          <div className="lab-list">
            {attempts.map((a) => (
              <div key={a.id} className={`lab-row ${verdict(a).replace(/\s/g, '').toLowerCase()}`}>
                <strong>{name(a.target)}</strong>
                <span className="lab-verdict">{verdict(a)}</span>
                {a.skipped ? (
                  <span className="muted">{a.skipped}: hands went down too soon to read</span>
                ) : (
                  <span>
                    Read as <b>{name(a.guesses[0]?.word ?? '')}</b> {pct(a.guesses[0]?.score ?? 0)}{a.sure ? '' : ' (would ask)'} · model: {a.raw.slice(0, 3).map((g) => `${name(g.word)} ${pct(g.score)}`).join(', ')}
                  </span>
                )}
                <small className="muted">{(a.ms / 1000).toFixed(1)} s · {a.frames} frames · hands seen {a.handsPct}% · body {a.posePct}% · {a.saved === 'saved' ? 'saved for analysis' : a.saved === 'saving' ? 'saving…' : 'not saved (live site)'}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
