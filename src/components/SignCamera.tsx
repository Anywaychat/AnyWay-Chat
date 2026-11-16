import { useEffect, useRef, useState } from 'react'
import { BookOpen, Delete, Send, X } from 'lucide-react'
import { glossToSentence, loadSignReader, SignReader, type Guess } from '../sign'
import { loadSigns } from '../signs'
import SignWordPicker from './SignWordPicker'

type Word = { word: string; options: Guess[] }

/**
 * Sign to the camera, one word at a time. Each sign becomes a word; tap a word to swap it
 * for the next-best guess. Everything runs on the phone; video never leaves it.
 */
export default function SignCamera({ onSend }: { onSend: (text: string, gloss: string, confidence: number) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [hands, setHands] = useState(false)
  const [recording, setRecording] = useState(false)
  const [words, setWords] = useState<Word[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [dict, setDict] = useState(false)
  // Sign ids like "goodmorning" -> readable "Good Morning".
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    void loadSigns().then((ws) => setNames(Object.fromEntries(ws.map((w) => [w.id, w.name]))))
  }, [])
  const say = (id: string) => names[id] ?? id

  useEffect(() => {
    let reader: SignReader | null = null
    let stream: MediaStream | null = null
    let alive = true
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
        // Left the chat while the camera was starting: turn it straight back off.
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const v = video.current!
        v.srcObject = stream
        await v.play()
        await loadSignReader()
        if (!alive) return
        reader = new SignReader(
          v,
          (guesses) => {
            if (guesses.length) setWords((w) => [...w, { word: guesses[0].word, options: guesses }])
          },
          (s) => {
            setHands(s.hands)
            setRecording(s.recording)
          },
        )
        await reader.start()
        setStatus('ready')
      } catch (e) {
        setStatus('error')
        setError((e as Error).name === 'NotAllowedError' ? 'Allow the camera to sign.' : 'The sign reader could not start on this device.')
      }
    })()
    return () => {
      alive = false
      reader?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const sentence = glossToSentence(words.map((w) => say(w.word).toLowerCase()))
  const confidence = words.length ? Math.round((words.reduce((s, w) => s + (w.options.find((o) => o.word === w.word)?.score ?? 0), 0) / words.length) * 100) : 0

  return (
    <>
    <div className="sign-panel">
      <div className="cam" aria-label="Camera preview">
        <video ref={video} playsInline muted className="cam-video" />
        {status === 'ready' && <span className="live-tag">LIVE</span>}
        <span className="hint-tag">
          {status === 'loading' ? 'Starting the sign reader…' : status === 'error' ? error : recording ? 'Reading your sign…' : hands ? 'Hands found' : 'Raise your hands to sign'}
        </span>
      </div>
      <div className="sign-read">
        <div className="gloss" aria-live="polite">
          {words.length === 0 && <span className="muted">Sign one word at a time. Lower your hands between words.</span>}
          {words.map((w, i) => (
            <button key={i} className="gloss-word" aria-label={`${say(w.word)}, tap to change`} onClick={() => setPicking(picking === i ? null : i)}>
              {say(w.word).toUpperCase()}
            </button>
          ))}
        </div>
        {picking !== null && words[picking] && (
          <div className="gloss-options" role="group" aria-label="Did you mean">
            {words[picking].options.map((o) => (
              <button key={o.word} className="pill" onClick={() => { setWords((ws) => ws.map((w, i) => (i === picking ? { ...w, word: o.word } : w))); setPicking(null) }}>
                {say(o.word)} <small>{Math.round(o.score * 100)}%</small>
              </button>
            ))}
            <button className="pill" onClick={() => { setWords((ws) => ws.filter((_, i) => i !== picking)); setPicking(null) }}><X size={13} aria-hidden="true" />Remove</button>
          </div>
        )}
        {sentence && <div className="will-send">Will send <strong>“{sentence}”</strong></div>}
        <div className="sign-actions">
          <button className="btn" aria-pressed={dict} onClick={() => setDict(!dict)}><BookOpen size={16} aria-hidden="true" />Dictionary</button>
          <button className="btn" disabled={!words.length} onClick={() => setWords((w) => w.slice(0, -1))}><Delete size={16} aria-hidden="true" />Undo</button>
          <button
            className="btn primary"
            disabled={!words.length}
            onClick={() => {
              onSend(sentence, words.map((w) => say(w.word).toUpperCase()).join(' · '), confidence)
              setWords([])
            }}
          >
            <Send size={16} aria-hidden="true" />Send
          </button>
        </div>
      </div>
    </div>
    {dict && (
      <div className="dict-drawer">
        <SignWordPicker compact onPick={(w) => setWords((ws) => [...ws, { word: w.id, options: [{ word: w.id, score: 1 }] }])} />
      </div>
    )}
    </>
  )
}