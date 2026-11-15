import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react'
import { contactById, useAuth } from '../state'
import { loadCallHistory, onHistoryChange, startCall, type CallRecord } from '../calls'
import { useConnection } from '../useChat'
import { Avatar, TabBar } from '../components/ui'

function when(t: number) {
  if (!t) return ''
  const d = new Date(t)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`
  const y = new Date(today.getTime() - 86400000)
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}

const length = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim() : `${s} s`)

export default function Calls() {
  const { contacts } = useAuth()
  const status = useConnection()
  const [history, setHistory] = useState<CallRecord[] | null>(null)

  useEffect(() => {
    if (status !== 'connected') return
    let alive = true
    const refresh = () => loadCallHistory().then((h) => alive && setHistory(h))
    refresh()
    const off = onHistoryChange(refresh)
    return () => {
      alive = false
      off()
    }
  }, [status])

  return (
    <div className="screen">
      <header className="home-head">
        <h1>Calls</h1>
      </header>
      <div className="scroll">
        <div className="list-label">Recent</div>
        {history === null && <p className="hint" style={{ padding: '8px 16px', textAlign: 'left' }}>Loading call history…</p>}
        {history?.length === 0 && <p className="hint" style={{ padding: '8px 16px', textAlign: 'left' }}>No calls yet. Call someone below.</p>}
        {history?.map((h) => {
          const c = contactById(h.peer)
          const Dir = h.missed ? PhoneMissed : h.outgoing ? PhoneOutgoing : PhoneIncoming
          return (
            <div key={h.callId} className="chat-row">
              <Avatar c={c} />
              <Link to={`/chat/${c.id}`} className="chat-row-main">
                <span className={`name${h.missed ? ' missed' : ''}`} style={{ fontWeight: 700 }}>{c.name}</span>
                <span className="preview call-meta">
                  <Dir size={14} aria-hidden="true" />
                  {h.missed ? (h.outgoing ? 'Not answered' : 'Missed') : h.outgoing ? 'Outgoing' : 'Incoming'} {h.video ? 'video' : 'voice'} call
                  {h.seconds > 0 && ` · ${length(h.seconds)}`}
                </span>
                <span className="preview">{when(h.time)}</span>
              </Link>
              <button className="icon-btn" aria-label={`${h.video ? 'Video' : 'Voice'} call ${c.name} again`} onClick={() => startCall(c.id, h.video)}>
                {h.video ? <Video size={20} aria-hidden="true" /> : <Phone size={19} aria-hidden="true" />}
              </button>
            </div>
          )
        })}

        <div className="list-label">Call someone</div>
        {contacts.length === 0 && <p className="hint" style={{ padding: '8px 16px', textAlign: 'left' }}>Add a contact to start calling.</p>}
        {contacts.map((c) => (
          <div key={c.id} className="chat-row">
            <Avatar c={c} />
            <div className="chat-row-main">
              <span className="name" style={{ fontWeight: 700 }}>{c.name}</span>
              <span className="preview">@{c.id}</span>
            </div>
            <button className="icon-btn" aria-label={`Voice call ${c.name}`} onClick={() => startCall(c.id, false)}><Phone size={19} aria-hidden="true" /></button>
            <button className="icon-btn" aria-label={`Video call ${c.name}`} onClick={() => startCall(c.id, true)}><Video size={20} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <TabBar />
    </div>
  )
}
