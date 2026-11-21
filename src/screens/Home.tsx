import { enablePush } from '../push'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, BookOpen, Footprints, Search, Sparkles, UserPlus, Users, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { contactById, useAuth, toContact, type Contact, type User } from '../state'
import { Avatar, TabBar } from '../components/ui'
import InstallButton from '../components/InstallButton'
import { useChannels, usePresence } from '../useChat'
import TryCard from '../components/TryCard'
import { useShowTry } from '../tryIt'
import PairModal from '../components/PairModal'
import { QrCode as QrIcon } from 'lucide-react'

const FILTERS = ['All', 'Unread'] as const

function timeLabel(t: number) {
  if (!t) return ''
  const d = new Date(t)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diff = (today.getTime() - t) / 86400000
  return diff < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** Priya (deaf), Arjun (blind) and Meera (can't speak) answer by themselves, so anyone can try AnyWay alone. */
function DemoInvite({ big = false }: { big?: boolean }) {
  const { startDemo } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setErr(await startDemo())
    setBusy(false)
  }
  return (
    <div className={big ? 'demo-invite big' : 'demo-invite'}>
      <span className="go-ico"><Sparkles size={18} aria-hidden="true" /></span>
      <span>
        <strong>Try it now with 3 demo friends</strong>
        <span className="sub">Priya is deaf and signs, Arjun is blind and talks, Meera can’t speak and taps. Each one answers in their own way.</span>
        {err && <span className="form-error" role="alert">{err}</span>}
      </span>
      <button className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Adding…' : 'Add them'}</button>
    </div>
  )
}

export default function Home() {
  const { user, contacts, groups } = useAuth()
  const { channels } = useChannels()
  const online = usePresence()
  const [makingGroup, setMakingGroup] = useState(false)
  const [notif, setNotif] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission)
  const { pathname } = useLocation()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const { show: showTry } = useShowTry()

  const byKey = new Map(channels.map((c) => [c.key, c]))
  const rows = [
    ...contacts.map((c) => ({ c, group: false, href: `/chat/${c.id}`, ch: byKey.get(`direct:${c.id}`) })),
    ...groups.map((g) => ({ c: { id: g.id, name: g.name, mode: 'standard' as const, initial: g.name.charAt(0).toUpperCase(), hue: 'slate' as const }, group: true, href: `/group/${g.id}`, ch: byKey.get(`group:${g.id}`) })),
  ]
    .filter(({ ch }) => (filter === 'Unread' ? (ch?.unread ?? 0) > 0 : true))
    .filter(({ c }) => !query || c.name.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase()))
    .sort((a, b) => (b.ch?.lastTime ?? 0) - (a.ch?.lastTime ?? 0))

  return (
    <div className="screen">
      <header className="home-head">
        <div className="row-between">
          <h1>Chats</h1>
          <div className="head-actions">
            <button className="icon-btn" aria-label="New group" onClick={() => setMakingGroup(true)}><Users size={20} aria-hidden="true" /></button>
            <button className="icon-btn" aria-label="Add a contact" onClick={() => setAdding(true)}><UserPlus size={20} aria-hidden="true" /></button>
          </div>
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input placeholder="Search" aria-label="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="filters" role="group" aria-label="Filter chats">
          {FILTERS.map((f) => (
            <button key={f} className="pill" aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        {/* Things to try: here on a phone; a laptop shows them on the big empty side instead. */}
        {showTry && <div className="try-in-list"><TryCard /></div>}
        {showTry && pathname !== '/home' && <Link to="/home" className="try-back">Things to try</Link>}
        {contacts.length > 0 && !contacts.some((c) => c.demo) && contacts.length < 3 && <DemoInvite />}
        {notif === 'default' && (
          <button className="notif-card" onClick={() => Notification.requestPermission().then((p) => { setNotif(p); if (p === 'granted') void enablePush() })}>
            <Bell size={16} aria-hidden="true" />Turn on notifications for new messages
          </button>
        )}
        <InstallButton compact />
        {user?.mode === 'deaf' && (
          <Link to="/signs" className="go-card">
            <span className="go-ico"><BookOpen size={18} aria-hidden="true" /></span>
            <span>
              <strong>Sign dictionary</strong>
              <span className="sub">Everyday words in Indian Sign Language</span>
            </span>
          </Link>
        )}
        {(
        <Link to="/go" className="go-card">
          <span className="go-ico"><Footprints size={18} aria-hidden="true" /></span>
          <span>
            <strong>Talk to someone near you</strong>
            <span className="sub">Use your phone as a live interpreter</span>
          </span>
        </Link>
        )}
      </header>

      <div className="scroll" role="list">
        {contacts.length === 0 && (
          <div className="empty-list">
            <DemoInvite big />
            <p>Or add someone you know.</p>
            <button className="btn" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" />Add a contact</button>
            <p className="hint">Ask a friend for their AnyWay username. You are <strong>@{user?.id}</strong>.</p>
          </div>
        )}
        {rows.map(({ c, ch, group, href }) => (
          <Link key={href} to={href} className={`chat-row${pathname === href ? ' active' : ''}`} role="listitem">
            {group ? <span className="avatar hue-slate" aria-hidden="true"><Users size={20} /></span> : <Avatar c={c} online={online.has(c.id)} />}
            <div className="chat-row-main">
              <div className="chat-row-top">
                <span className="name">{c.name}{'demo' in c && c.demo && <span className="demo-tag">Demo</span>}</span>
                <time className={ch?.unread ? 'new' : ''}>{timeLabel(ch?.lastTime ?? 0)}</time>
              </div>
              <div className="chat-row-bottom">
                <span className="preview">{ch?.lastText ? `${ch.lastFrom === user?.id ? 'You' : group ? contactById(ch.lastFrom).name : ''}${ch.lastFrom === user?.id || group ? ': ' : ''}${ch.lastText}` : group ? 'New group' : `@${c.id}`}</span>
                {ch?.unread ? <span className="badge" aria-label={`${ch.unread} unread`}>{ch.unread}</span> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <TabBar />
      {adding && <AddContact onClose={() => setAdding(false)} />}
      {makingGroup && <NewGroup onClose={() => setMakingGroup(false)} />}
    </div>
  )
}

function AddContact({ onClose }: { onClose: () => void }) {
  const { api, addContact, contacts, user } = useAuth()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Contact[]>([])
  const [searched, setSearched] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [qr, setQr] = useState(false)

  const search = async (value: string) => {
    setQ(value)
    setMsg(null)
    if (value.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    const r = await api<{ users: User[] }>(`/users/search?q=${encodeURIComponent(value)}`).catch(() => ({ users: [] }))
    setResults(r.users.map(toContact))
    setSearched(true)
  }

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add a contact" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>Add a contact</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input autoFocus placeholder="Search by username or name" aria-label="Search people" value={q} onChange={(e) => search(e.target.value)} />
        </label>
        <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Your username is <strong>@{user?.id}</strong>. Share it so friends can add you.</p>
        <button type="button" className="btn" onClick={() => setQr(true)}><QrIcon size={16} aria-hidden="true" />Someone next to you? Show a QR code</button>
        {qr && <PairModal purpose="friend" onClose={() => setQr(false)} />}
        <div className="modal-list">
          {searched && results.length === 0 && <p className="muted">No one found with that name.</p>}
          {results.map((r) => {
            const already = contacts.some((c) => c.id === r.id)
            return (
              <div key={r.id} className="chat-row" style={{ padding: '8px 4px' }}>
                <Avatar c={r} size="sm" />
                <div className="chat-row-main">
                  <span className="name" style={{ fontWeight: 700 }}>{r.name}</span>
                  <span className="muted">@{r.id}</span>
                </div>
                <button
                  className={`btn${already ? '' : ' primary'}`}
                  style={{ height: 36 }}
                  disabled={already}
                  onClick={async () => {
                    const err = await addContact(r.id)
                    setMsg(err ?? `${r.name} added. They can now chat with you too.`)
                  }}
                >
                  {already ? 'Added' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
        {msg && <p className="form-ok" role="status">{msg}</p>}
      </div>
    </div>
  )
}

function NewGroup({ onClose }: { onClose: () => void }) {
  const { contacts, createGroup } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New group"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const id = await createGroup(name, picked)
            onClose()
            if (id) nav(`/group/${id}`)
          } catch (err) {
            setError((err as Error).message)
          }
          setBusy(false)
        }}
      >
        <div className="row-between">
          <h2>New group</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        <label className="field-label">Group name
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} />
        </label>
        <div className="field-label" style={{ marginBottom: -4 }}>Members</div>
        <div className="modal-list">
          {contacts.length === 0 && <p className="muted">Add contacts first, then make a group with them.</p>}
          {contacts.map((c) => (
            <label key={c.id} className="chat-row pick-row">
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
              <Avatar c={c} size="sm" />
              <span className="chat-row-main"><strong>{c.name}</strong><span className="muted">@{c.id}</span></span>
            </label>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy || !name.trim() || picked.length === 0}>
          {busy ? 'Creating…' : `Create group${picked.length ? ` with ${picked.length}` : ''}`}
        </button>
      </form>
    </div>
  )
}
