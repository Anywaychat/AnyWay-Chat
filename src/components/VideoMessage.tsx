import { useEffect, useRef, useState } from 'react'
import { Circle, Gauge, RotateCcw, Send, Square } from 'lucide-react'

export const isVideoName = (n?: string) => !!n && /\.(mp4|webm|mov|m4v)$/i.test(n)
const MAX = 60

/** Record a short video (e.g. signing) and send it as a message. */
export function VideoRecorder({ onSend }: { onSend: (f: File) => void }) {
  const live = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const mr = useRef<MediaRecorder | null>(null)
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle')
  const [secs, setSecs] = useState(0)
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: true })
      .then((s) => { if (!alive) { s.getTracks().forEach((t) => t.stop()); return } stream.current = s; if (live.current) live.current.srcObject = s })
      .catch(() => setErr('Allow the camera for this site to record a video message.'))
    return () => { alive = false; stream.current?.getTracks().forEach((t) => t.stop()) }
  }, [])
  useEffect(() => {
    if (state !== 'rec') return
    const t = setInterval(() => setSecs((s) => { if (s + 1 >= MAX) mr.current?.stop(); return s + 1 }), 1000)
    return () => clearInterval(t)
  }, [state])
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url) }, [clip])

  const start = () => {
    if (!stream.current) return
    const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 600_000 })
    const chunks: Blob[] = []
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = () => { const blob = new Blob(chunks, { type: r.mimeType }); setClip({ blob, url: URL.createObjectURL(blob) }); setState('done') }
    mr.current = r
    r.start(500)
    setSecs(0)
    setState('rec')
    navigator.vibrate?.(60)
  }
  const send = () => {
    if (!clip) return
    const ext = clip.blob.type.includes('mp4') ? 'mp4' : 'webm'
    onSend(new File([clip.blob], `video-message-${Date.now()}.${ext}`, { type: clip.blob.type }))
    setClip(null)
    setState('idle')
  }

  if (err) return <p className="form-error" role="alert">{err}</p>
  return (
    <div className="vrec">
      {state === 'done' && clip ? (
        <video className="vrec-view" src={clip.url} controls playsInline aria-label="Your video, before sending" />
      ) : (
        <video ref={live} className="vrec-view mirror" autoPlay muted playsInline aria-label="Camera preview" />
      )}
      {state === 'rec' && <span className="vrec-time" role="status"><span className="rec-dot" aria-hidden="true" />{secs}s / {MAX}s</span>}
      <div className="vrec-bar">
        {state === 'idle' && <button type="button" className="btn primary" onClick={start}><Circle size={16} fill="currentColor" aria-hidden="true" />Record video</button>}
        {state === 'rec' && <button type="button" className="btn primary" onClick={() => mr.current?.stop()}><Square size={16} fill="currentColor" aria-hidden="true" />Stop</button>}
        {state === 'done' && (
          <>
            <button type="button" className="btn" onClick={() => { setClip(null); setState('idle') }}><RotateCcw size={16} aria-hidden="true" />Retake</button>
            <button type="button" className="btn primary" onClick={send}><Send size={16} aria-hidden="true" />Send video</button>
          </>
        )}
      </div>
    </div>
  )
}

/** Video player inside a message, with slow motion for reading signs. */
export function VideoPlayer({ src, label }: { src: string; label: string }) {
  const v = useRef<HTMLVideoElement>(null)
  const [rate, setRate] = useState(1)
  const next = () => { const r = rate === 1 ? 0.5 : rate === 0.5 ? 0.75 : 1; setRate(r); if (v.current) v.current.playbackRate = r }
  return (
    <div className="vplay">
      <video ref={v} src={src} controls playsInline preload="metadata" aria-label={label} />
      <button type="button" className="vplay-rate" onClick={next} aria-label={`Playback speed ${rate}x. Tap to change.`}><Gauge size={14} aria-hidden="true" />{rate}x</button>
    </div>
  )
}
