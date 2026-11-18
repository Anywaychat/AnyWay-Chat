import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpDown, Hand, Keyboard, LayoutGrid, Mic, RotateCcw, Send, Volume2, X } from 'lucide-react'
import { useAuth, useProfile, type Mode } from '../state'
import { base, getLang, LANGS, langName } from '../lang'
import { announce, canListen, listenOnce, speak, stopSpeaking, type Listening } from '../speech'
import SignCamera from '../components/SignCamera'
import SignStrip from '../components/SignStrip'
import PhraseBoard from '../components/PhraseBoard'

/**
 * Go mode: one phone between two people, AnyWay interprets both ways. Nothing is sent anywhere except text for
 * translation, and nothing is saved.
 * - Your half: what they said, in your language (signs for deaf users, read aloud for blind users), and your way to answer.
 * - Their half (upside down on a phone, so it faces them): what you said, big, and spoken aloud for them; plus a big
 *   Speak button and a keyboard so they can answer without installing anything.
 */
type Turn = { id: number; who: 'me' | 'them'; text: string; mine: string; theirs: string; lang: string; how: 'spoken' | 'typed' | 'signed' | 'tapped' }

const SHOW: Record<Mode, string> = {
  deaf: 'I am deaf. Please speak to my phone, or type here. I will read it and answer.',
  speech: 'I can’t speak. Please talk to my phone, and it will say my answers out loud.',
  blind: 'I am blind. Please speak to me or type here, and my phone will read it to me.',
  standard: 'Please speak to my phone, or type here. AnyWay will translate for us.',
}

export default function Go() {
  const { mode } = useProfile()
  const { api } = useAuth()
  const myLang = getLang()
  const [theirLang, setTheirLang] = useState(myLang)
  const [turns, setTurns] = useState<Turn[]>([])
  const [flip, setFlip] = useState(true)
  const [way, setWay] = useState<'sign' | 'tap' | 'type' | 'speak'>(mode === 'deaf' ? 'sign' : mode === 'speech' ? 'tap' : 'speak')
  const n = useRef(0)
  const translate = async (text: string, from: string, to: string) => {
    if (base(from) === base(to)) return text
    try {
      return (await api<{ text: string }>('/translate', { method: 'POST', body: { text, from, to } })).text || text
    } catch {
      return text
    }
  }
  const blind = mode === 'blind'
  useEffect(() => {
    if (blind) announce('Face to face. Put the phone between you. Tap Speak at the bottom to talk. The other person can tap Speak at the top, or type. I will read their words to you.', true)
    return () => stopSpeaking()
  }, [blind])

  /** I said something: show it big on their side, and say it out loud for them unless I spoke it myself. */
  const fromMe = async (text: string, how: Turn['how']) => {
    const t = text.trim()
    if (!t) return
    const theirs = await translate(t, myLang, theirLang)
    setTurns((l) => [...l.slice(-30), { id: n.current++, who: 'me', text: t, mine: t, theirs, lang: theirLang, how }])
    if (how !== 'spoken') speak(theirs, true, theirLang)
  }
  /** They said something: show it on my side in my language; signs for deaf users, read aloud for blind users. */
  const fromThem = async (text: string, how: Turn['how']) => {
    const t = text.trim()
    if (!t) return
    const mine = await translate(t, theirLang, myLang)
    setTurns((l) => [...l.slice(-30), { id: n.current++, who: 'them', text: t, mine, theirs: t, lang: theirLang, how }])
    navigator.vibrate?.(mode === 'deaf' ? [200, 80, 200] : 60)
    if (blind) announce(`They said: ${mine}`, true)
  }

  const lastMe = [...turns].reverse().find((x) => x.who === 'me')
  const lastThem = [...turns].reverse().find((x) => x.who === 'them')

  return (
    <div className={`screen go2${flip ? ' flip' : ''}`}>
      <h1 className="sr-only">Face to face</h1>
      {/* Their half: faces the other person */}
      <section className="go2-them" aria-label="For the person you are talking to">
        <div className="go2-row">
          <strong>For the other person</strong>
          <label className="go2-lang">
            Their language
            <select value={theirLang} onChange={(e) => setTheirLang(e.target.value)} aria-label="Their language">
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
            </select>
          </label>
        </div>
        <div className="go2-big" aria-live="polite" dir="auto">
          {lastMe ? lastMe.theirs : SHOW[mode]}
        </div>
        {lastMe && base(lastMe.lang) !== base(myLang) && <p className="go2-small" dir="auto">{lastMe.mine}</p>}
        <TheirInput lang={theirLang} onSay={fromThem} />
      </section>

      <div className="go2-seam">
        <ArrowUpDown size={16} aria-hidden="true" />
        <span>AnyWay interpreter: put the phone between you</span>
        <button type="button" className="chip-btn" aria-pressed={flip} onClick={() => setFlip((f) => !f)}><RotateCcw size={13} aria-hidden="true" />{flip ? 'Facing them' : 'Facing me'}</button>
      </div>

      {/* My half */}
      <section className="go2-me" aria-label="Your side">
        <div className="go2-row">
          <strong>Your side</strong>
          <Link to="/home" className="go2-end"><X size={16} aria-hidden="true" />End</Link>
        </div>
        <div className="go2-big mine" aria-live={blind ? 'off' : 'polite'} dir="auto">
          {lastThem ? lastThem.mine : <span className="go2-wait">What they say appears here{mode === 'deaf' ? ', in sign language too' : blind ? ', and I read it to you' : ''}.</span>}
        </div>
        {lastThem && base(lastThem.lang) !== base(myLang) && <p className="go2-small" dir="auto">{langName(lastThem.lang)}: {lastThem.text}</p>}
        {lastThem && mode === 'deaf' && <SignStrip key={lastThem.id} text={lastThem.mine} autoPlay />}
        {lastThem && blind && <button type="button" className="btn" onClick={() => announce(`They said: ${lastThem.mine}`, true)}><Volume2 size={16} aria-hidden="true" />Hear it again</button>}

        <div className="mode-bar" role="group" aria-label="How you answer">
          {mode === 'deaf' && <button className="pill" aria-pressed={way === 'sign'} onClick={() => setWay('sign')}><Hand size={14} aria-hidden="true" />Sign</button>}
          {(mode === 'speech' || mode === 'deaf') && <button className="pill" aria-pressed={way === 'tap'} onClick={() => setWay('tap')}><LayoutGrid size={14} aria-hidden="true" />Phrases</button>}
          {(mode === 'blind' || mode === 'standard') && <button className="pill" aria-pressed={way === 'speak'} onClick={() => setWay('speak')}><Mic size={14} aria-hidden="true" />Speak</button>}
          <button className="pill" aria-pressed={way === 'type'} onClick={() => setWay('type')}><Keyboard size={14} aria-hidden="true" />Type</button>
        </div>
        {way === 'sign' && <SignCamera context={lastThem?.mine ?? ''} onSend={(text) => void fromMe(text, 'signed')} />}
        {way === 'tap' && <PhraseBoard onPick={(t) => void fromMe(t, 'tapped')} />}
        {way === 'speak' && <SpeakButton lang={myLang} label="Speak" onSay={(t) => void fromMe(t, 'spoken')} big={blind} />}
        {way === 'type' && <TypeBox placeholder={mode === 'speech' || mode === 'deaf' ? 'Type, and AnyWay says it out loud' : 'Type your answer'} onSay={(t) => void fromMe(t, 'typed')} />}

        {turns.length > 1 && (
          <details className="go2-log">
            <summary>Conversation ({turns.length})</summary>
            {turns.map((x) => (
              <p key={x.id} className={x.who === 'me' ? 'me' : ''}><b>{x.who === 'me' ? 'You' : 'They'}:</b> <span dir="auto">{x.mine}</span></p>
            ))}
          </details>
        )}
      </section>
    </div>
  )
}

/** Their way to answer: a big Speak button in their language, or typing. */
function TheirInput({ lang, onSay }: { lang: string; onSay: (text: string, how: Turn['how']) => void }) {
  const [typing, setTyping] = useState(false)
  return (
    <div className="go2-their-input">
      {typing ? (
        <TypeBox placeholder="Type here" onSay={(t) => onSay(t, 'typed')} onClose={() => setTyping(false)} />
      ) : (
        <div className="grid-2">
          <SpeakButton lang={lang} label="Tap and speak" onSay={(t) => onSay(t, 'spoken')} />
          <button type="button" className="btn" onClick={() => setTyping(true)}><Keyboard size={18} aria-hidden="true" />Type</button>
        </div>
      )}
    </div>
  )
}

function SpeakButton({ lang, label, onSay, big = false }: { lang: string; label: string; onSay: (text: string) => void; big?: boolean }) {
  const [live, setLive] = useState<Listening | null>(null)
  const [sofar, setSofar] = useState('')
  const [err, setErr] = useState('')
  const start = () => {
    if (live) return live.stop()
    setErr('')
    setSofar('')
    const l = listenOnce(
      setSofar,
      (text) => {
        setLive(null)
        setSofar('')
        if (text) onSay(text)
      },
      (msg) => {
        setLive(null)
        setErr(msg)
      },
      lang,
    )
    if (!l) setErr('This browser can’t listen. Use Chrome, or type instead.')
    setLive(l)
  }
  useEffect(() => () => live?.cancel(), [live])
  return (
    <>
      <button type="button" className={`btn primary${big ? ' talk-btn' : ''}${live ? ' live' : ''}`} onClick={start} disabled={!canListen}>
        <Mic size={18} aria-hidden="true" />
        {live ? sofar || 'Listening… tap when done' : label}
      </button>
      {err && <p className="form-error" role="alert">{err}</p>}
    </>
  )
}

function TypeBox({ placeholder, onSay, onClose }: { placeholder: string; onSay: (text: string) => void; onClose?: () => void }) {
  const [text, setText] = useState('')
  return (
    <form
      className="go2-type"
      onSubmit={(e) => {
        e.preventDefault()
        onSay(text)
        setText('')
      }}
    >
      <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} dir="auto" />
      <button className="btn primary" disabled={!text.trim()} aria-label="Send"><Send size={16} aria-hidden="true" /></button>
      {onClose && <button type="button" className="btn" onClick={onClose} aria-label="Close keyboard"><X size={16} aria-hidden="true" /></button>}
    </form>
  )
}
