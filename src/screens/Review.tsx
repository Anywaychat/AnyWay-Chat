import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Delete, Grid2x2, Hand, Keyboard, Mic, Star } from 'lucide-react'
import { useAuth, useProfile, type Mode } from '../state'
import { canListen, listenOnce, speak, type Listening } from '../speech'
import SignCamera from '../components/SignCamera'
import BrailleKeys from '../components/BrailleKeys'

type Way = 'speak' | 'sign' | 'tap' | 'braille' | 'type'
const WAYS: Record<Way, { label: string; icon: typeof Mic; saved: string }> = {
  speak: { label: 'Speak', icon: Mic, saved: 'Spoken' },
  sign: { label: 'Sign', icon: Hand, saved: 'Signed (ISL)' },
  tap: { label: 'Tap', icon: Grid2x2, saved: 'Tapped' },
  braille: { label: 'Braille', icon: Delete, saved: 'Braille' },
  type: { label: 'Type', icon: Keyboard, saved: 'Typed' },
}
// Each person starts in their own way of talking, and can switch.
const FIRST: Record<Mode, Way[]> = {
  blind: ['speak', 'type'],
  deaf: ['sign', 'type'],
  speech: ['tap', 'type'],
  deafblind: ['braille', 'type'],
  standard: ['type', 'speak'],
}
const PHRASES = ['I love AnyWay', 'Easy to use', 'It helps me talk to my family', 'It helps me talk to my friends', 'I can chat on my own now', 'Please add more signs', 'Please make it faster', 'Thank you']

type Mine = { rating: number; text: string; lang: string; showName: boolean } | null

/** Review AnyWay in your own way: speak, sign, tap, braille or type. One review per person. */
export default function Review() {
  const { api } = useAuth()
  const { mode } = useProfile()
  const nav = useNavigate()
  const ways = FIRST[mode]
  const [way, setWay] = useState<Way>(ways[0])
  const used = useRef(new Set<Way>())
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [showName, setShowName] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState('')
  const listening = useRef<Listening | null>(null)
  const [isListening, setIsListening] = useState(false)

  useEffect(() => {
    void api<{ review: Mine }>('/reviews/mine').then(({ review }) => {
      if (!review) return
      setRating(review.rating)
      setText(review.text)
      setShowName(review.showName)
    }).catch(() => {})
    if (mode === 'blind') speak('Review AnyWay. Choose stars from 1 to 5, then tap Speak and say your review.')
  }, [api, mode])

  const add = (words: string, how: Way) => {
    used.current.add(how)
    setText((t) => (t.trim() ? `${t.trim()} ${words}` : words))
  }

  const startSpeaking = () => {
    if (isListening) { listening.current?.stop(); return }
    setHeard('')
    listening.current = listenOnce(
      (sofar) => setHeard(sofar),
      (final) => {
        setIsListening(false)
        setHeard('')
        if (final.trim()) {
          add(final.trim(), 'speak')
          if (mode === 'blind') speak(`I heard: ${final.trim()}. Tap Send review when you're ready.`)
        }
      },
      (e) => { setIsListening(false); setMsg({ ok: false, text: e }) },
    )
    setIsListening(!!listening.current)
  }

  const send = async () => {
    setBusy(true)
    setMsg(null)
    if (way === 'type') used.current.add('type')
    const how = [...used.current].map((w) => WAYS[w].saved).join(' + ') || WAYS[way].saved
    try {
      await api('/reviews', { method: 'POST', body: { rating, text, lang: how, showName } })
      setMsg({ ok: true, text: 'Thank you! Your review is saved. You can change it any time.' })
      if (mode === 'blind') speak('Thank you. Your review is saved.')
      navigator.vibrate?.([120, 80, 120])
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
    setBusy(false)
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn back-btn" style={{ display: 'grid' }} aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <div className="topbar-title"><strong>Review AnyWay</strong><span>In your own way: speak, sign, tap, braille or type</span></div>
      </header>
      <div className="scroll">
        <form className="section review-form" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <fieldset className="stars">
            <legend>How would you rate AnyWay?</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={rating >= n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => { setRating(n); if (mode === 'blind') speak(`${n} star${n > 1 ? 's' : ''}`, true) }}>
                <Star size={34} fill={rating >= n ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            ))}
          </fieldset>

          <div className="mode-bar" role="group" aria-label="How do you want to give your review?">
            {(Object.keys(WAYS) as Way[]).filter((w) => ways.includes(w) || w === 'type').map((w) => {
              const I = WAYS[w].icon
              return <button key={w} type="button" className="pill" aria-pressed={way === w} onClick={() => setWay(w)}><I size={14} aria-hidden="true" />{WAYS[w].label}</button>
            })}
          </div>

          {way === 'speak' && (
            <div className="review-way">
              <button type="button" className={`talk-btn${isListening ? ' live' : ''}`} onClick={startSpeaking} disabled={!canListen} aria-label={isListening ? 'Listening. Tap to stop.' : 'Tap to speak your review'}>
                <Mic size={22} aria-hidden="true" />{isListening ? (heard || 'Listening…') : 'Tap to speak your review'}
              </button>
              {!canListen && <p className="hint">Speaking isn't supported in this browser. Please type instead.</p>}
            </div>
          )}

          {way === 'sign' && (
            <div className="review-way">
              <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Sign your review one word at a time, or pick signs below. Tap Send in the sign panel to add the words.</p>
              <SignCamera context="How was AnyWay? Good, thank you, happy." onSend={(t) => add(t, 'sign')} />
            </div>
          )}

          {way === 'tap' && (
            <div className="phrases review-way">
              {PHRASES.map((p) => <button key={p} type="button" className="tile" onClick={() => { add(p.endsWith('.') ? p : `${p}.`, 'tap'); speak(p) }}>{p}</button>)}
            </div>
          )}

          {way === 'braille' && <BrailleKeys onText={(update) => { used.current.add('braille'); setText(update) }} />}

          <label className="field-label">Your review
            <textarea className="input" dir="auto" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} required placeholder="What did AnyWay help you do? What should we make better?" />
            <span className="field-hint">You can fix the words here before sending. {text.length}/1500</span>
          </label>

          <label className="check-row">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Show my name with my review
          </label>

          {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
          <button className="btn primary block" disabled={busy || !rating || !text.trim()}>{busy ? 'Saving…' : 'Send review'}</button>
        </form>
      </div>
    </div>
  )
}
