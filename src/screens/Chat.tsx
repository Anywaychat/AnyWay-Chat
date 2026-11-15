import { createContext, useContext, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Check, CheckCheck, FileText, Hand, Users, Keyboard, LayoutGrid, Mic, MoreVertical, Paperclip, Phone, Send, Smile, Video, Volume2 } from 'lucide-react'
import { contactById, useAuth, useProfile, type Mode } from '../state'
import { usePresence, useThread } from '../useChat'
import { startCall } from '../calls'
import type { Origin as MsgOrigin } from '../nexconn'

type SendFn = (text: string, origin: MsgOrigin) => void
interface Actions {
  sendFile: (f: File) => void
  notifyTyping: () => void
}
const ActionsCtx = createContext<Actions>({ sendFile: () => {}, notifyTyping: () => {} })
const kb = (n = 0) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
import { Avatar, BackButton } from '../components/ui'

export default function Chat({ kind = 'direct' }: { kind?: 'direct' | 'group' }) {
  const { id = '' } = useParams()
  const { groups } = useAuth()
  const isGroup = kind === 'group'
  const group = isGroup ? groups.find((g) => g.id === id) : undefined
  const c = isGroup ? { ...contactById(id), name: group?.name ?? 'Group', initial: (group?.name ?? 'G').charAt(0).toUpperCase(), hue: 'slate' as const } : contactById(id)
  const { mode } = useProfile()
  const online = usePresence()
  const { messages, send, sendFile, notifyTyping, status, loading, me, typing } = useThread({ kind, id })
  const lastIn = [...messages].reverse().find((m) => m.from !== me)
  const subtitle =
    status === 'error'
      ? 'offline, check your connection'
      : status === 'connecting'
        ? 'connecting…'
        : typing.length
          ? isGroup
            ? `${typing.map((t) => contactById(t).name).join(', ')} typing…`
            : 'typing…'
          : isGroup
            ? `${group?.members.length ?? 0} members: ${group?.members.map((m) => (m.id === me ? 'you' : m.name)).join(', ') ?? ''}`
            : online.has(c.id) ? 'online' : 'offline'

  if (mode === 'deafblind') return <DeafBlindChat name={c.name} />

  return (
    <div className="screen">
      <header className="topbar">
        <BackButton />
        {isGroup ? <span className="avatar sm hue-slate" aria-hidden="true"><Users size={18} /></span> : <Avatar c={c} size="sm" online={online.has(c.id)} />}
        <div className="topbar-title">
          <strong>{c.name}</strong>
          <span className={typing.length || (!isGroup && online.has(c.id)) ? 'online' : ''}>{subtitle}</span>
        </div>
        {!isGroup && <button className="icon-btn" aria-label={`Voice call ${c.name}`} onClick={() => startCall(c.id, false)}><Phone size={19} aria-hidden="true" /></button>}
        {!isGroup && <button className="icon-btn" aria-label={`Video call ${c.name}`} onClick={() => startCall(c.id, true)}><Video size={20} aria-hidden="true" /></button>}
        <button className="icon-btn" aria-label="More options"><MoreVertical size={19} aria-hidden="true" /></button>
      </header>

      {mode === 'blind' && lastIn && (
        <div className="readout" role="status">
          <Volume2 size={18} aria-hidden="true" />
          Latest from {contactById(lastIn.from).name}: “{lastIn.text}”
        </div>
      )}

      <div className="scroll">
        <div className="thread">
          <span className="e2e">Messages are translated on your device into the way each person understands them.</span>
          {loading && status === 'connected' && <span className="day">Loading messages…</span>}
          {!loading && messages.length === 0 && <span className="day">No messages yet. Say hello{isGroup ? ' to the group' : ` to ${c.name}`}.</span>}
          {messages.map((m, i) => {
            const mine = m.from === me
            const playing = mode === 'blind' && m === lastIn
            return (
              <div key={m.id + i} className={`msg ${mine ? 'me' : 'them'}${playing ? ' playing' : ''}`}>
                <div className="bubble">
                  {isGroup && !mine && <div className="sender">{contactById(m.from).name}</div>}
                  {m.type === 'image' && (
                    <a href={m.url} target="_blank" rel="noreferrer" className="photo">
                      <img src={m.url || m.thumb} alt="Photo" />
                    </a>
                  )}
                  {m.type === 'file' && (
                    <a href={m.url} target="_blank" rel="noreferrer" className="file-chip">
                      <FileText size={22} aria-hidden="true" />
                      <span><strong>{m.fileName}</strong><small>{kb(m.fileSize)}</small></span>
                    </a>
                  )}
                  {m.type === 'text' && m.text}
                  <span className="stamp">
                    {fmt(m.sentTime)}
                    {mine && !isGroup && (m.read ? <CheckCheck size={14} className="read" aria-label="Read" /> : <Check size={14} aria-label="Sent" />)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {typing.length > 0 && <div className="typing-row" aria-live="polite"><span className="dots"><i /><i /><i /></span>{isGroup ? `${contactById(typing[0]).name} is typing` : `${c.name} is typing`}</div>}
      <ActionsCtx.Provider value={{ sendFile, notifyTyping }}>
      {mode === 'blind' && <BlindComposer name={c.name} onSend={send} />}
      {mode === 'deaf' && <DeafComposer onSend={send} />}
      {mode === 'speech' && <SpeechComposer onSend={send} />}
      {mode === 'standard' && <TextComposer onSend={send} />}
      </ActionsCtx.Provider>
    </div>
  )
}

function TextField({ placeholder = 'Message', onSend, mode }: { placeholder?: string; onSend: SendFn; mode: Mode }) {
  const [text, setText] = useState('')
  const { sendFile, notifyTyping } = useContext(ActionsCtx)
  const fileRef = useRef<HTMLInputElement>(null)
  const submit = () => {
    if (!text.trim()) return
    onSend(text, { mode: mode === 'speech' ? 'speech' : mode === 'deafblind' ? 'deafblind' : 'standard' })
    setText('')
  }
  return (
    <form className="text-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="field">
        <button type="button" className="icon-btn" aria-label="Emoji"><Smile size={19} aria-hidden="true" /></button>
        <input placeholder={placeholder} aria-label="Message" value={text} onChange={(e) => { setText(e.target.value); notifyTyping() }} />
        <button type="button" className="icon-btn" aria-label="Send a photo or file" onClick={() => fileRef.current?.click()}><Paperclip size={19} aria-hidden="true" /></button>
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
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
