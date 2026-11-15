import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Check, CheckCheck, FileText, Hand, Users, Keyboard, LayoutGrid, Mic, Paperclip, Pencil, Phone, Reply, Search, Send, SmilePlus, Info, Trash2, Video, Volume2, X } from 'lucide-react'
import { contactById, useAuth, useProfile, type Mode } from '../state'
import { usePresence, useThread } from '../useChat'
import { startCall } from '../calls'
import { canListen, listenOnce, speak, type Listening } from '../speech'
import { registerChatVoice, understand } from '../voice'
import { describePhoto } from '../vision'
import { sendText } from '../nexconn'
import { useNavigate } from 'react-router-dom'
import ChatInfo from './ChatInfo'
import type { ChatMessage, Origin as MsgOrigin } from '../nexconn'

type SendFn = (text: string, origin: MsgOrigin) => void
interface Actions {
  sendFile: (f: File) => void
  sendVoice: (b: Blob) => void
  notifyTyping: () => void
  draft: string
}
const ActionsCtx = createContext<Actions>({ sendFile: () => {}, sendVoice: () => {}, notifyTyping: () => {}, draft: '' })
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const kb = (n = 0) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
import { Avatar, BackButton } from '../components/ui'

export default function Chat({ kind = 'direct' }: { kind?: 'direct' | 'group' }) {
  const { id = '' } = useParams()
  const { groups, blocked, contacts } = useAuth()
  const nav = useNavigate()
  const [info, setInfo] = useState(false)
  const isGroup = kind === 'group'
  const group = isGroup ? groups.find((g) => g.id === id) : undefined
  const c = isGroup ? { ...contactById(id), name: group?.name ?? 'Group', initial: (group?.name ?? 'G').charAt(0).toUpperCase(), hue: 'slate' as const } : contactById(id)
  const { mode } = useProfile()
  const online = usePresence()
  const { messages, send, sendFile, sendVoice, reply, edit, remove, react, notifyTyping, status, loading, me, typing, failed } = useThread({ kind, id })
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const shown = searching && query.trim() ? messages.filter((m) => m.text.toLowerCase().includes(query.trim().toLowerCase())) : messages
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!searching) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, searching])
  const submit: SendFn = (text, origin) => {
    if (editing) {
      void edit(editing.id, text)
      setEditing(null)
    } else if (replyTo) {
      void reply(text, origin, replyTo)
      setReplyTo(null)
    } else void send(text, origin)
  }
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  const explain = async (m: ChatMessage, aloud = false) => {
    if (!m.url) return
    setDescriptions((d) => ({ ...d, [m.id]: d[m.id] ?? 'Describing…' }))
    const text = (await describePhoto(m.url)) ?? "Couldn't describe this photo."
    setDescriptions((d) => ({ ...d, [m.id]: text }))
    if (aloud) speak(`The photo shows: ${text}`, true)
  }
  // Blind users get every photo in the chat described automatically.
  useEffect(() => {
    if (mode !== 'blind') return
    messages.filter((m) => m.type === 'image' && !descriptions[m.id]).slice(-3).forEach((m) => void explain(m))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, mode])
  const preview = (m: ChatMessage) => (m.type === 'text' ? m.text : m.type === 'image' ? 'Photo' : m.type === 'voice' ? 'Voice message' : m.fileName ?? 'File')

  /* ---------- Blind: voice commands, read-back, Space to talk ---------- */
  const say = (m: ChatMessage) => `${m.from === me ? 'You' : contactById(m.from).name} ${m.from === me ? 'said' : 'says'}: ${preview(m)}`
  const runVoice = (raw: string) => {
    const it = understand(raw, contacts, true)
    switch (it.kind) {
      case 'help':
        return speak('Just talk normally. For example: send Priya I am on my way. Call Meera. Read my messages. Or say your message and it goes to this chat.', true)
      case 'read': {
        const last = messages.slice(-5)
        return speak(last.length ? last.map(say).join('. ') : 'There are no messages here yet.', true)
      }
      case 'repeat':
        return speak(lastIn ? say(lastIn) : 'No message to repeat yet.', true)
      case 'list':
        return speak(contacts.length ? `Your chats: ${contacts.map((p) => p.name).join(', ')}.` : 'You have no contacts yet.', true)
      case 'next': {
        if (!contacts.length) return speak('You have no other chats yet.', true)
        const i = contacts.findIndex((p) => p.id === id)
        return nav(`/chat/${contacts[(i + 1) % contacts.length].id}`)
      }
      case 'call':
        speak(`Calling ${it.who.name}`, true)
        return void startCall(it.who.id, it.video)
      case 'open':
        return it.who.id === id ? speak(lastIn ? say(lastIn) : `You're already in ${it.who.name}'s chat.`, true) : nav(`/chat/${it.who.id}`)
      case 'describe': {
        const photo = [...messages].reverse().find((m) => m.type === 'image')
        if (!photo) return speak('There are no photos in this chat yet.', true)
        speak('Looking at the photo…', true)
        return void explain(photo, true)
      }
      case 'previous': {
        if (!contacts.length) return speak('You have no other chats yet.', true)
        const i = contacts.findIndex((p) => p.id === id)
        return nav(`/chat/${contacts[(i - 1 + contacts.length) % contacts.length].id}`)
      }
      case 'search': {
        const q = it.query.toLowerCase()
        const found = messages.filter((m) => m.text.toLowerCase().includes(q))
        setSearching(true)
        setQuery(it.query)
        return speak(found.length ? `Found ${found.length}. ${found.slice(-3).map(say).join('. ')}` : `Nothing here mentions ${it.query}.`, true)
      }
      case 'react':
        if (!lastIn) return speak('There is no message to react to yet.', true)
        void react(lastIn.id, it.emoji)
        return speak(`Reacted to ${contactById(lastIn.from).name}'s message.`, true)
      case 'deleteLast': {
        const mineLast = [...messages].reverse().find((m) => m.from === me)
        if (!mineLast) return speak("You haven't sent anything here yet.", true)
        void remove(mineLast.id)
        return speak('Deleted your last message.', true)
      }
      case 'editLast': {
        const mineLast = [...messages].reverse().find((m) => m.from === me && m.type === 'text')
        if (!mineLast) return speak("You haven't sent a message here yet.", true)
        void edit(mineLast.id, it.text)
        return speak('Edited.', true)
      }
      case 'send':
        if (!isGroup && it.who.id === id) submit(it.text, { mode: 'blind' })
        else void sendText({ kind: 'direct', id: it.who.id }, it.text, { mode: 'blind' })
        return speak(`Sent to ${it.who.name}.`, true)
      default:
        submit(raw.trim(), { mode: 'blind' })
        return speak('Sent.', false)
    }
  }
  const talk = useTapToTalk(runVoice)
  const runRef = useRef(runVoice)
  runRef.current = runVoice
  useEffect(() => (mode === 'blind' ? registerChatVoice((t) => runRef.current(t)) : undefined), [mode])
  useEffect(() => {
    if (mode !== 'blind') return
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e)) { e.preventDefault(); talk.start() }
      if (e.code === 'Escape') talk.stop()
      if (e.key.toLowerCase() === 'r' && e.altKey) { e.preventDefault(); speak(lastIn ? say(lastIn) : 'No message yet.', true) }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  })
  const announced = useRef(false)
  useEffect(() => {
    if (mode !== 'blind' || loading || announced.current) return
    announced.current = true
    speak(`Chat with ${c.name}. ${lastIn ? `Last message, ${say(lastIn)}` : 'No messages yet.'} Say Hey Chat, or press Space, to talk.`, true)
  })
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
        <button className="icon-btn" aria-label={isGroup ? 'Group info' : 'Contact info'} onClick={() => setInfo(true)}><Info size={19} aria-hidden="true" /></button>
        <button className="icon-btn" aria-label="Search in this chat" aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery('') }}><Search size={19} aria-hidden="true" /></button>
      </header>
      {searching && (
        <div className="chat-search">
          <Search size={16} aria-hidden="true" />
          <input autoFocus placeholder="Search messages" aria-label="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="muted">{query.trim() ? `${shown.length} found` : ''}</span>
          <button className="icon-btn" aria-label="Close search" onClick={() => { setSearching(false); setQuery('') }}><X size={18} aria-hidden="true" /></button>
        </div>
      )}

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
          {searching && query.trim() && shown.length === 0 && <span className="day">No messages match “{query}”.</span>}
          {shown.map((m, i) => {
            const mine = m.from === me
            const playing = mode === 'blind' && m === lastIn
            return (
              <div key={m.id + i} className={`msg ${mine ? 'me' : 'them'}${playing ? ' playing' : ''}${menu === m.id ? ' menu-open' : ''}`}>
                <div className="bubble-wrap">
                <div className="bubble">
                  {isGroup && !mine && <div className="sender">{contactById(m.from).name}</div>}
                  {m.replyTo && (
                    <div className="quote">
                      <strong>{m.replyTo.from === me ? 'You' : contactById(m.replyTo.from).name}</strong>
                      <span>{m.replyTo.text}</span>
                    </div>
                  )}
                  {m.type === 'voice' && <audio className="voice" controls preload="metadata" src={m.url} />}
                  {m.type === 'image' && (
                    <>
                      <a href={m.url} target="_blank" rel="noreferrer" className="photo">
                        <img src={m.url || m.thumb} alt={descriptions[m.id] ?? 'Photo'} />
                      </a>
                      {(mode === 'blind' || descriptions[m.id]) && (
                        <div className="photo-desc">
                          {descriptions[m.id] ?? (
                            <button className="link-btn" onClick={() => void explain(m)}>Describe this photo</button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {m.type === 'file' && (
                    <a href={m.url} target="_blank" rel="noreferrer" className="file-chip">
                      <FileText size={22} aria-hidden="true" />
                      <span><strong>{m.fileName}</strong><small>{kb(m.fileSize)}</small></span>
                    </a>
                  )}
                  {m.type === 'text' && m.text}
                  <span className="stamp">
                    {m.edited && <span className="edited">edited</span>}
                    {fmt(m.sentTime)}
                    {mine && !isGroup && (m.read ? <CheckCheck size={14} className="read" aria-label="Read" /> : <Check size={14} aria-label="Sent" />)}
                  </span>
                </div>
                <button className="msg-more" aria-label="Message options" onClick={() => setMenu(menu === m.id ? null : m.id)}><SmilePlus size={16} aria-hidden="true" /></button>
                {menu === m.id && (
                  <div className="msg-menu" role="menu">
                    <div className="emoji-row">
                      {EMOJIS.map((e) => (
                        <button key={e} role="menuitem" aria-label={`React ${e}`} onClick={() => { void react(m.id, e); setMenu(null) }}>{e}</button>
                      ))}
                    </div>
                    <button role="menuitem" onClick={() => { setReplyTo(m); setEditing(null); setMenu(null) }}><Reply size={15} aria-hidden="true" />Reply</button>
                    {mine && m.type === 'text' && <button role="menuitem" onClick={() => { setEditing(m); setReplyTo(null); setMenu(null) }}><Pencil size={15} aria-hidden="true" />Edit</button>}
                    {mine && <button role="menuitem" className="danger" onClick={() => { if (confirm('Delete this message for everyone?')) void remove(m.id); setMenu(null) }}><Trash2 size={15} aria-hidden="true" />Delete for everyone</button>}
                  </div>
                )}
                </div>
                {m.reactions && (
                  <div className="reactions">
                    {Object.entries(m.reactions).map(([e, ids]) => (
                      <button key={e} className={`reaction${ids.includes(me) ? ' mine' : ''}`} onClick={() => void react(m.id, e)} title={ids.map((u) => (u === me ? 'You' : contactById(u).name)).join(', ')}>
                        {e} {ids.length > 1 ? ids.length : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {typing.length > 0 && <div className="typing-row" aria-live="polite"><span className="dots"><i /><i /><i /></span>{isGroup ? `${contactById(typing[0]).name} is typing` : `${c.name} is typing`}</div>}
      {failed && <div className="send-failed" role="alert">{failed}</div>}
      {info && <ChatInfo kind={kind} id={id} onClose={() => setInfo(false)} />}
      {!isGroup && blocked.includes(c.id) ? (
        <div className="blocked-bar">You blocked {c.name}. <button className="link" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => setInfo(true)}>Unblock</button> to send messages.</div>
      ) : (<>
      {(replyTo || editing) && (
        <div className="reply-bar">
          {editing ? <Pencil size={16} aria-hidden="true" /> : <Reply size={16} aria-hidden="true" />}
          <div>
            <strong>{editing ? 'Editing message' : `Replying to ${replyTo!.from === me ? 'yourself' : contactById(replyTo!.from).name}`}</strong>
            <span>{preview((editing ?? replyTo)!)}</span>
          </div>
          <button className="icon-btn" aria-label="Cancel" onClick={() => { setReplyTo(null); setEditing(null) }}><X size={18} aria-hidden="true" /></button>
        </div>
      )}
      <ActionsCtx.Provider value={{ sendFile, sendVoice, notifyTyping, draft: editing?.text ?? '' }}>
      {mode === 'blind' && (
        <>
          <BlindComposer name={c.name} talk={talk} />
          <div className="composer" style={{ paddingTop: 0, borderTop: 0 }}><TextField onSend={(t) => submit(t, { mode: 'blind' })} mode="blind" placeholder="Or type a message" /></div>
        </>
      )}
      {mode === 'deaf' && <DeafComposer key={editing?.id} onSend={submit} />}
      {mode === 'speech' && <SpeechComposer key={editing?.id} onSend={submit} />}
      {mode === 'standard' && <TextComposer key={editing?.id} onSend={submit} />}
      </ActionsCtx.Provider>
      </>)}
    </div>
  )
}

function TextField({ placeholder = 'Message', onSend, mode }: { placeholder?: string; onSend: SendFn; mode: Mode }) {
  const { sendFile, sendVoice, notifyTyping, draft } = useContext(ActionsCtx)
  const [text, setText] = useState(draft)
  const fileRef = useRef<HTMLInputElement>(null)
  const rec = useRecorder(sendVoice)
  const submit = () => {
    if (!text.trim()) return
    onSend(text, { mode: mode === 'speech' ? 'speech' : mode === 'deafblind' ? 'deafblind' : 'standard' })
    setText('')
  }
  if (rec.recording)
    return (
      <div className="text-compose">
        <div className="field recording" role="status">
          <span className="rec-dot" aria-hidden="true" />Recording {mmss(rec.seconds)}
        </div>
        <button type="button" className="icon-btn" aria-label="Cancel recording" onClick={rec.cancel}><Trash2 size={19} aria-hidden="true" /></button>
        <button type="button" className="send" aria-label="Send voice message" onClick={rec.stop}><Send size={18} aria-hidden="true" /></button>
      </div>
    )
  return (
    <form className="text-compose" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="field">
        <input autoFocus={!!draft} placeholder={placeholder} aria-label="Message" value={text} onChange={(e) => { setText(e.target.value); notifyTyping() }} />
        <button type="button" className="icon-btn" aria-label="Send a photo or file" onClick={() => fileRef.current?.click()}><Paperclip size={19} aria-hidden="true" /></button>
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = '' }} />
      </div>
      {text.trim() || draft ? (
        <button type="submit" className="send" aria-label={draft ? 'Save edit' : 'Send'}>{draft ? <Check size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}</button>
      ) : (
        <button type="button" className="send" aria-label="Record a voice message" onClick={rec.start}><Mic size={18} aria-hidden="true" /></button>
      )}
      {rec.error && <p className="form-error" style={{ position: 'absolute', marginTop: 52 }}>{rec.error}</p>}
    </form>
  )
}

/** Records a voice note with the browser's microphone. */
function useRecorder(onDone: (b: Blob) => void) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<{ mr: MediaRecorder; chunks: Blob[]; cancelled: boolean; timer: ReturnType<typeof setInterval> } | null>(null)
  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const r = { mr, chunks: [] as Blob[], cancelled: false, timer: setInterval(() => setSeconds((s) => s + 1), 1000) }
      ref.current = r
      mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data)
      mr.onstop = () => {
        clearInterval(r.timer)
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        setSeconds(0)
        if (!r.cancelled && r.chunks.length) onDone(new Blob(r.chunks, { type: mr.mimeType }))
      }
      mr.start()
      setRecording(true)
    } catch {
      setError('Allow the microphone for this site to record voice messages.')
    }
  }
  const stop = () => ref.current?.mr.stop()
  const cancel = () => {
    if (ref.current) ref.current.cancelled = true
    ref.current?.mr.stop()
  }
  return { recording, seconds, error, start, stop, cancel }
}

function TextComposer({ onSend }: { onSend: SendFn }) {
  return (
    <div className="composer">
      <TextField onSend={onSend} mode="standard" />
    </div>
  )
}

interface Talk {
  listening: boolean
  sofar: string
  error: string | null
  start: () => void
  stop: () => void
}

/** Tap to talk: speech in, final words out when you pause. Shared by the button and the Space key. */
function useTapToTalk(onDone: (text: string) => void): Talk {
  const [listening, setListening] = useState(false)
  const [sofar, setSofar] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<Listening | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const start = () => {
    if (ref.current) {
      ref.current.stop()
      return
    }
    setError(null)
    setSofar('')
    if (!canListen) {
      setError('This browser cannot listen. Use Chrome or Edge, or type below.')
      speak('This browser cannot listen. Please use Chrome.', true)
      return
    }
    ref.current = listenOnce(
      setSofar,
      (text) => {
        ref.current = null
        setListening(false)
        setSofar('')
        if (text) doneRef.current(text)
        else speak("I didn't catch that. Tap and try again.", true)
      },
      (msg) => {
        ref.current = null
        setListening(false)
        setError(msg)
        speak(msg, true)
      },
    )
    setListening(!!ref.current)
  }
  const stop = () => ref.current?.stop()
  return { listening, sofar, error, start, stop }
}

function BlindComposer({ name, talk }: { name: string; talk: Talk }) {
  return (
    <div className="composer">
      <div className="mode-bar" aria-label="Things you can say">
        <span className="label">You can say</span>
        <span className="pill">Read my messages</span><span className="pill">Repeat</span><span className="pill">Call {name}</span><span className="pill">Next chat</span><span className="pill">Help</span>
      </div>
      <button
        className={`talk-btn${talk.listening ? ' live' : ''}`}
        aria-label={talk.listening ? 'Listening. Pause to send.' : 'Tap to speak'}
        onClick={talk.start}
      >
        <Mic size={22} aria-hidden="true" />
        {talk.listening ? (talk.sofar || 'Listening…') : 'Tap to speak'}
      </button>
      <p className="hint" style={{ margin: 0 }} aria-live="polite">
        {talk.error ?? 'Or just say “Hey Chat” and then your message. It sends when you pause.'}
      </p>
    </div>
  )
}

function DeafComposer({ onSend }: { onSend: SendFn }) {
  const { draft } = useContext(ActionsCtx)
  const [signing, setSigning] = useState(!draft)
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
