import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Footprints, Search, SquarePen } from 'lucide-react'
import { CONTACTS, useProfile } from '../state'
import { Avatar, ModeIcon, TabBar } from '../components/ui'

const FILTERS = ['All', 'Unread', 'Groups'] as const

export default function Home() {
  const { mode, me } = useProfile()
  const { pathname } = useLocation()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const blindish = mode === 'blind' || mode === 'deafblind'
  const list = filter === 'Unread' ? CONTACTS.filter((c) => c.unread && c.id !== me) : filter === 'Groups' ? [] : CONTACTS.filter((c) => c.id !== me)

  return (
    <div className="screen">
      <header className="home-head">
        <div className="row-between">
          <h1>Chats</h1>
          <div className="head-actions">
            <button className="icon-btn" aria-label="New chat"><SquarePen size={20} aria-hidden="true" /></button>
          </div>
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input placeholder={blindish ? 'Say or type a name' : 'Search'} aria-label="Search chats" />
        </label>
        <div className="filters" role="group" aria-label="Filter chats">
          {FILTERS.map((f) => (
            <button key={f} className="pill" aria-pressed={f === filter} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <Link to="/go" className="go-card">
          <span className="go-ico"><Footprints size={18} aria-hidden="true" /></span>
          <span>
            <strong>Talk to someone near you</strong>
            <span className="sub">Use your phone as a live interpreter</span>
          </span>
        </Link>
      </header>

      <div className="scroll" role="list">
        {list.length === 0 && <p className="hint" style={{ padding: 24 }}>No chats here yet.</p>}
        {list.map((c) => (
          <Link key={c.id} to={`/chat/${c.id}`} className={`chat-row${pathname === `/chat/${c.id}` ? ' active' : ''}`} role="listitem">
            <Avatar c={c} online={c.online} />
            <div className="chat-row-main">
              <div className="chat-row-top">
                <span className="name">{c.name}</span>
                <time className={c.unread ? 'new' : ''}>{c.time}</time>
              </div>
              <div className="chat-row-bottom">
                <span className={`mode-tag mode-${c.mode}`} title={c.lastVia}><ModeIcon mode={c.mode} size={14} /></span>
                <span className="preview">{c.last}</span>
                {c.unread ? <span className="badge" aria-label={`${c.unread} unread`}>{c.unread}</span> : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
      <TabBar />
    </div>
  )
}
