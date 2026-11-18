import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Shuffle, Trash2, Undo2 } from 'lucide-react'
import { forgetSign, framingHint, isSure, loadSignReader, mySigns, onMySignsChange, setSignBoost, SignReader, teachSign, topWords, type Guess, type Pt, type Segment } from '../sign'
import { loadSigns, type SignWord } from '../signs'
import SignClip from '../components/SignClip'
import { readSession } from '../state'

/**
 * Sign lab: a test bench for the sign reader. Pick a word, sign it, and see exactly what the reader saw and guessed.
 * Teach mode keeps each attempt as the person's own example of the word (on this device), so the reader learns
 * their way of signing (see "Your own signs" in sign.ts).
 * On a development computer each attempt (its tracked points, the model's guesses and a short video) is also saved
 * in data/signlab, so misreadings can be replayed and studied. Saving is refused on the live site.
 */
const TEACH_EACH = 3
const STARTERS = ['hello', 'thankyou', 'goodmorning', 'howareyou', 'good', 'bad', 'happy', 'sad', 'nice', 'alright', 'friend', 'mother', 'father', 'doctor', 'house', 'school', 'today', 'tomorrow', 'i', 'you', 'we', 'beautiful', 'hot', 'cold', 'sick', 'money']

type Attempt = { id: string; target: string; mode: 'test' | 'teach'; guesses: Guess[]; raw: Guess[]; sure: boolean; ms: number; frames: number; handsPct: number; posePct: number; skipped?: string; capped?: boolean; taught?: number; removed?: boolean; saved: 'saving' | 'saved' | 'local only' }
type Live = { fps: number; hands: number; pose: boolean; hint: string }

const r4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)

export default function SignLab() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'test' | 'teach'>(params.get('teach') ? 'teach' : 'test')
  const modeRef = useRef(mode)
  const [taught, setTaught] = useState<Record<string, number>>(() => mySigns())
  const [note, setNote] = useState('')
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
  const wordsRef = useRef<SignWord[]>([])
  useEffect(() => {
    targetRef.current = target
    wordsRef.current = words
    modeRef.current = mode
  })
  useEffect(() => onMySignsChange(() => setTaught(mySigns())), [])

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
    let segTarget: SignWord | undefined
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
      const v = video.current
      const hint = framingHint(pts, pose, v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3)
      setLive({ fps: Math.round(fps), hands, pose, hint })
    }

    const onState = ({ recording }: { hands: boolean; recording: boolean }) => {
      setReading(recording)
      if (recording && !wasRecording) {
        // The attempt belongs to the word shown when it started (not when it ended: pressing Next mid-sign
        // used to credit the end of one word's attempt to the next word).
        segTarget = targetRef.current
        segId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${segTarget?.id ?? 'none'}`
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
      const t = segTarget ?? targetRef.current
      const m = modeRef.current
      const frames = s.frames
      const ms = frames.length ? frames[frames.length - 1].t - frames[0].t : 0
      const seen = (from: number, to: number) => frames.filter((f) => f.pts.slice(from, to).some(([x]) => Number.isFinite(x))).length / Math.max(1, frames.length)
      const raw = s.skipped ? [] : await topWords(frames, s.aspect, 5)
      // Teach: keep it as this person's example of the word, unless it ran into the 6 s limit (then it holds more
      // than one sign, or resting hands) or was too short to read.
      let count: number | undefined
      if (m === 'teach' && t && !s.skipped && !s.capped && s.vector) {
        count = await teachSign(t.id, id, s.vector)
        if (count >= TEACH_EACH) {
          const list = wordsRef.current
          const next = list[list.indexOf(t) + 1]
          if (next && targetRef.current?.id === t.id) {
            setAt(list.indexOf(next))
            setNote(`${t.name} taught. Next word: ${next.name}.`)
          } else setNote(`${t.name} taught.`)
        } else setNote(`${t.name}: example ${count} of ${TEACH_EACH} kept.`)
      } else if (m === 'teach' && s.capped) setNote('That took over 6 seconds, so it was not kept. Lower your hands out of the picture after each sign.')
      const a: Attempt = { id, target: t?.id ?? '', mode: m, guesses: s.guesses, raw, sure: isSure(s.guesses), ms, frames: frames.length, handsPct: Math.round(seen(25, 67) * 100), posePct: Math.round(seen(0, 25) * 100), skipped: s.skipped, capped: s.capped, taught: count, saved: 'saving' }
      setAttempts((l) => [a, ...l])
      const v = video.current
      const ok = await upload(
        'signlab',
        id,
        JSON.stringify({ id, target: a.target, mode: m, taught: count ?? null, capped: !!s.capped, guesses: s.guesses, raw, sure: a.sure, skipped: s.skipped ?? null, aspect: s.aspect, ms, camera: v ? [v.videoWidth, v.videoHeight] : null, userAgent: navigator.userAgent, frames: frames.map((f) => ({ t: Math.round(f.t), pts: f.pts.map(([x, y]) => [r4(x), r4(y)]) })) }),
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

  const done = attempts.filter((a) => !a.skipped && a.mode === 'test')
  const tooShort = attempts.filter((a) => a.skipped && a.mode === 'test').length
  const right = done.filter((a) => a.guesses[0]?.word === a.target).length
  const top3 = done.filter((a) => a.raw.slice(0, 3).some((g) => g.word === a.target)).length
  const asked = done.filter((a) => !a.sure).length
  const name = (id: string) => words.find((w) => w.id === id)?.name ?? id
  const pct = (n: number) => `${Math.round(n * 100)}%`
  const verdict = (a: Attempt) => (a.mode === 'teach' ? (a.removed ? 'Removed' : a.taught ? 'Taught' : 'Not kept') : a.skipped ? 'Skipped' : a.guesses[0]?.word === a.target ? 'Right' : a.raw.slice(0, 3).some((g) => g.word === a.target) ? 'In top 3' : 'Wrong')
  const matches = query.trim() ? words.filter((w) => w.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : []

  const copy = async () => {
    const lines = attempts
      .slice()
      .reverse()
      .map((a) => `${a.mode === 'teach' ? '[teach] ' : ''}${name(a.target)} → ${a.skipped ? a.skipped : `${name(a.guesses[0]?.word ?? '')} (${pct(a.guesses[0]?.score ?? 0)})${a.sure ? '' : ' asked'} | model: ${a.raw.slice(0, 3).map((g) => `${name(g.word)} ${pct(g.score)}`).join(', ')} | ${verdict(a)}${a.guesses[0]?.mine ? ' (your example)' : ''}`} | ${(a.ms / 1000).toFixed(1)} s, ${a.frames} frames, hands ${a.handsPct}%`)
    const text = `Sign lab: ${right}/${done.length} right, ${top3}/${done.length} in top 3, ${asked} asked · taught words: ${Object.keys(taught).length}\n${lines.join('\n')}`
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
        <div className="topbar-title"><h1 className="topbar-name">Sign lab</h1><span>Teach the reader your signs, then test it</span></div>
      </header>
      <div className="scroll lab">
        <section className="lab-target" aria-label="Word to sign">
          <div className="lab-word">
            <div className="lab-mode" role="radiogroup" aria-label="Lab mode">
              {(['test', 'teach'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} className={`chip-btn${mode === m ? ' on' : ''}`} onClick={() => { setMode(m); setNote('') }}>
                  {m === 'test' ? 'Test' : 'Teach'}
                </button>
              ))}
            </div>
            <span className="muted">{mode === 'teach' ? `Sign this word ${TEACH_EACH} times, like the clip` : 'Sign this word'}</span>
            <strong>{target?.name ?? '…'}</strong>
            {target && taught[target.id] ? <span className="lab-taught">Taught: {taught[target.id]} example{taught[target.id] > 1 ? 's' : ''}</span> : null}
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
          {note && <p className="lab-note" role="status">{note}</p>}
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>
            {mode === 'teach'
              ? 'Teach: each attempt is kept as your own example of the word, on this device only (the movement, not the video). The reader then knows your way of signing it.'
              : 'Sign once, then lower your hands out of the picture.'}{' '}
            Dots: white = body, red and blue = your two hands. If the dots don't follow your fingers, the reader can't see them.
          </p>
        </section>

        <section className="lab-results">
          <div className="row-between">
            <h2>Attempts</h2>
            <button className="btn" onClick={() => void copy()} disabled={!attempts.length}><Copy size={16} aria-hidden="true" />{copied ? 'Copied' : 'Copy results'}</button>
          </div>
          {Object.keys(taught).length > 0 && (
            <p className="lab-mine">
              Your signs: {Object.entries(taught).map(([w, n]) => `${name(w)} ×${n}`).join(', ')}{' '}
              <button className="link-btn" onClick={() => { if (confirm('Forget every sign you taught on this device?')) forgetSign() }}><Trash2 size={14} aria-hidden="true" />Forget all</button>
            </p>
          )}
          <p className="lab-sum">{done.length ? `${right} of ${done.length} right · ${top3} in the top 3 · asked "Did you sign…?" ${asked} times` : 'No attempts yet.'}{tooShort ? ` · ${tooShort} too short` : ''}</p>
          <div className="lab-list">
            {attempts.map((a) => (
              <div key={a.id} className={`lab-row ${verdict(a).replace(/\s/g, '').toLowerCase()}`}>
                <strong>{name(a.target)}</strong>
                <span className="lab-verdict">{verdict(a)}</span>
                {a.mode === 'teach' ? (
                  <span>
                    {a.removed
                      ? 'Example removed.'
                      : a.taught
                        ? `Example ${a.taught} of ${TEACH_EACH} kept for ${name(a.target)}.`
                        : a.capped
                          ? 'Not kept: over 6 seconds. Lower your hands out of the picture after each sign.'
                          : a.skipped
                            ? `Not kept: ${a.skipped}.`
                            : 'Not kept.'}{' '}
                    {a.taught && !a.removed ? (
                      <button className="link-btn" onClick={() => { forgetSign(a.target, a.id); setAttempts((l) => l.map((x) => (x.id === a.id ? { ...x, removed: true } : x))) }}>
                        <Undo2 size={14} aria-hidden="true" />Remove
                      </button>
                    ) : null}
                  </span>
                ) : a.skipped ? (
                  <span className="muted">{a.skipped}: hands went down too soon to read</span>
                ) : (
                  <span>
                    Read as <b>{name(a.guesses[0]?.word ?? '')}</b> {pct(a.guesses[0]?.score ?? 0)}{a.guesses[0]?.mine ? ' (your example)' : ''}{a.sure ? '' : ' (would ask)'}{a.capped ? ' · over 6 s: lower your hands between signs' : ''} · model: {a.raw.slice(0, 3).map((g) => `${name(g.word)} ${pct(g.score)}`).join(', ')}
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
