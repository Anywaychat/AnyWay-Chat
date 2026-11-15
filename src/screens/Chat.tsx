import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Camera, CheckCheck, Hand, Keyboard, LayoutGrid, Mic, MoreVertical, Paperclip, Phone, Send, Smile, Video, Volume2 } from 'lucide-react'
import { contactById, useProfile, type Mode } from '../state'
import { useThread } from '../useChat'
import type { Origin as MsgOrigin } from '../nexconn'

type SendFn = (text: string, origin: MsgOrigin) => void
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
import { Avatar, BackButton, ModeIcon, Wave } from '../components/ui'

const MADE: Record<Mode, string> = {
  deaf: 'Signed in ISL',
  blind: 'Spoken',
  speech: 'Tapped',
  deafblind: 'Braille',
  standard: 'Spoken',
}

const HOW: Record<Mode, string> = {
  deaf: 'signs in ISL',
  blind: 'speaks',
  speech: 'taps phrases',
  deafblind: 'uses braille',
  standard: 'talks and types',
}

function Origin({ mode, gloss }: { mode: Mode; gloss?: string }) {
  const voice = mode === 'blind' || mode === 'standard'
  return (
    <div className="origin">
      {voice ? <Wave n={8} /> : <ModeIcon mode={mode} size={13} />}
      {MADE[mode]}
      {gloss && mode === 'deaf' && <span className="gloss-inline">{gloss}</span>}
    </div>
  )
}

export default function Chat() {
  const { id } = useParams()
  const c = contactById(id)
  const { mode } = useProfile()
  const { messages, send, status, loading, me } = useThread(c.id)
  const lastIn = [...messages].reverse().find((m) => m.from !== me)

  if (mode === 'deafblind') return <DeafBlindChat name={c.name} />

  return (
    <div className="screen">
      <header className="topbar">
        <BackButton />
        <Avatar c={c} size="sm" />
        <div className="topbar-title">
          <strong>{c.name}</strong>
          <span>{status === 'connected' ? <span className="online">connected</span> : status === 'error' ? 'offline, check the connection' : 'connecting…'} · {HOW[c.mode]}</span>
        </div>
        <Link to={`/call/voice/${c.id}`} className="icon-btn" aria-label={`Voice call ${c.name}`}><Phone size={19} aria-hidden="true" /></Link>
        <Link to={`/call/video/${c.id}`} className="icon-btn" aria-label={`Video call ${c.name}`}><Video size={20} aria-hidden="true" /></Link>
        <button className="icon-btn" aria-label="More options"><MoreVertical size={19} aria-hidden="true" /></button>
      </header>

      {mode === 'blind' && lastIn && (
        <div className="readout" role="status">
          <Volume2 size={18} aria-hidden="true" />
          Latest from {c.name}: “{lastIn.text}”
        </div>
      )}

      <div className="scroll">
        <div className="thread">
          <span className="e2e">Messages are translated on your device into the way each person understands them.</span>
          {loading && status === 'connected' && <span className="day">Loading messages…</span>}
          {!loading && messages.length === 0 && <span className="day">No messages yet. Say hello to {c.name}.</span>}
          {messages.map((m, i) => {
            const mine = m.from === me
            const playing = mode === 'blind' && m === lastIn
            const omode = m.origin?.mode ?? (mine ? mode : c.mode)
            return (
              <div key={m.id + i} className={`msg ${mine ? 'me' : 'them'}${playing ? ' playing' : ''}`}>
                <div className="bubble">
                  <Origin mode={omode} gloss={m.origin?.gloss} />
                  {m.text}
                  <span className="stamp">
                    {fmt(m.sentTime)}
                    {mine && <CheckCheck size={14} aria-label="Sent" />}
                  </span>
                  {!mine && mode === 'deaf' && omode !== 'deaf' && (
                    <div className="sign-clip">
                      <span className="thumb"><Hand size={18} aria-hidden="true" /></span>
                      Watch in ISL
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {mode === 'blind' && <BlindComposer name={c.name} onSend={send} />}
      {mode === 'deaf' && <DeafComposer onSend={send} />}
      {mode === 'speech' && <SpeechComposer onSend={send} />}
      {mode === 'standard' && <TextComposer onSend={send} />}
    </div>
  )
}

function TextField({ placeholder = 'Message', onSend, mode }: { placeholder?: string; onSend: SendFn; mode: Mode }) {
  const [text, setText] = useState('')
  const submit = () => {
    if (!text.trim()) return
    onSend(text, { mode: mode === 'speech' ? 'speech' : mode === 'deafblind' ? 'deafblind' : 'standard' })
    setText('')
  }
  return (
    <form className="text-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="field">
        <button type="button" className="icon-btn" aria-label="Emoji"><Smile size={19} aria-hidden="true" /></button>
        <input placeholder={placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="icon-btn" aria-label="Attach"><Paperclip size={19} aria-hidden="true" /></button>
      </div>
      <button type="submit" className="send" aria-label="Send"><Send size={18} aria-hidden="true" /></button>
    </form>
  )
}

function TextComposer({ onSend }: { onSend: SendFn }) {
  return (
    <div className="composer">
      <TextField onSend={onSend} mode="standard" />
    </div>
  )
}

function BlindComposer({ name, onSend }: { name: string; onSend: SendFn }) {
  return (
    <div className="composer">
      <div className="mode-bar" aria-label="Things you can say">
        <span className="label">Say</span>
        <span className="pill">Repeat</span><span className="pill">Reply</span><span className="pill">Call {name}</span><span className="pill">Next chat</span>
      </div>
      <button className="talk-btn"><Mic size={22} aria-hidden="true" />Hold to speak</button>
      <p className="hint" style={{ margin: 0 }}>Let go to send. Double-tap to hear the last message again.</p>
      <TextField onSend={(t) => onSend(t, { mode: 'blind' })} mode="blind" placeholder="Or type a message" />
    </div>
  )
}

function DeafComposer({ onSend }: { onSend: SendFn }) {
  const [signing, setSigning] = useState(true)
  return (
    <div className="composer">
      <div className="mode-bar">
        <button className="pill" aria-pressed={signing} onClick={() => setSigning(true)}><Hand size={14} aria-hidden="true" />Sign</button>
        <button className="pill" aria-pressed={!signing} onClick={() => setSigning(false)}><Keyboard size={14} aria-hidden="true" />Type</button>
      </div>
      {signing ? (
        <div className="sign-panel">
          <div className="cam" aria-label="Camera preview">
            <span className="live-tag">LIVE</span>
            <svg width="96" height="96" viewBox="0 0 120 120" fill="none" aria-hidden="true">
              <circle cx="60" cy="34" r="16" stroke="#3A404A" strokeWidth="2" />
              <path d="M28 112c0-22 14-36 32-36s32 14 32 36" stroke="#3A404A" strokeWidth="2" />
              <path d="M30 76l8-10 8-5M88 74l-7-10" stroke="#8FA8FF" strokeWidth="2.5" />
              {[[30, 76], [38, 66], [46, 61], [88, 74], [81, 64]].map(([x, y]) => (
                <circle key={`${x}${y}`} cx={x} cy={y} r="3.5" fill="#8FA8FF" />
              ))}
            </svg>
            <span className="hint-tag">Hands found</span>
          </div>
          <div className="sign-read">
            <div className="gloss"><b>YES</b><b>8</b><b>COME</b><span className="conf">92% match</span></div>
            <div className="will-send">Will send <strong>“Yes, I’ll come at 8.”</strong></div>
            <div className="sign-actions">
              <button className="btn"><Camera size={16} aria-hidden="true" />Redo</button>
              <button className="btn primary" onClick={() => onSend('Yes, I’ll come at 8.', { mode: 'deaf', gloss: 'YES · 8 · COME', confidence: 92 })}><Send size={16} aria-hidden="true" />Send</button>
            </div>
          </div>
        </div>
      ) : (
        <TextField onSend={(t) => onSend(t, { mode: 'deaf' })} mode="deaf" />
      )}
    </div>
  )
}

const CATS = ['Everyday', 'Health', 'Shop', 'Travel', 'Mine']
const TILES = ['Yes', 'No', 'Thank you', 'Please wait', 'I need help', 'Please repeat', 'How much?', 'Emergency']

function SpeechComposer({ onSend }: { onSend: SendFn }) {
  const [cat, setCat] = useState('Everyday')
  return (
    <div className="composer">
      <div className="mode-bar" role="group" aria-label="Phrase groups">
        <LayoutGrid size={14} color="var(--ink-3)" aria-hidden="true" />
        {CATS.map((k) => (
          <button key={k} className="pill" aria-pressed={k === cat} onClick={() => setCat(k)}>{k}</button>
        ))}
      </div>
      <div className="phrases">
        {TILES.map((t) => (
          <button key={t} className={`tile${t === 'Emergency' ? ' alert' : ''}`} onClick={() => onSend(t, { mode: 'speech' })}>{t}</button>
        ))}
      </div>
      <TextField onSend={onSend} mode="speech" placeholder="Or type, and AnyWay will say it" />
    </div>
  )
}

function DeafBlindChat({ name }: { name: string }) {
  const [dots, setDots] = useState<number[]>([1, 3])
  const toggle = (d: number) => setDots((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))
  return (
    <div className="screen db">
      <div className="row-between">
        <BackButton />
        <strong style={{ fontSize: 18 }}>From {name}</strong>
        <span className="muted">1 of 3</span>
      </div>
      <div className="db-card">
        <div className="big">Are you coming tonight?</div>
        <p className="muted" style={{ margin: '10px 0 0' }}>Signed at 10:42</p>
      </div>
      <div>
        <p className="muted" style={{ margin: '0 0 8px' }}>Felt as</p>
        <div className="pulse-row" aria-label="Long, short, short, long">
          <i style={{ width: 56 }} /><i style={{ width: 16 }} /><i style={{ width: 16 }} /><i style={{ width: 56 }} />
        </div>
      </div>
      <div className="grid-2">
        <button className="btn">Previous</button>
        <button className="btn">Next</button>
      </div>
      <div style={{ flex: 1 }} />
      <div className="db-draft">Yes, coming in 5 min_</div>
      <div className="braille" role="group" aria-label="Braille keys">
        {[1, 2, 3, 4, 5, 6].map((d) => (
          <button key={d} aria-pressed={dots.includes(d)} aria-label={`Dot ${d}`} onClick={() => toggle(d)}>{d}</button>
        ))}
      </div>
      <button className="btn primary block">Send</button>
    </div>
  )
}
