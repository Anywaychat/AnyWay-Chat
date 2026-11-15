import { Link } from 'react-router-dom'
import { Phone, PhoneIncoming, PhoneOutgoing, Video } from 'lucide-react'
import { CONTACTS } from '../state'
import { Avatar, ModeTag, TabBar } from '../components/ui'

const LOG = [
  { id: 'priya', kind: 'video', dir: 'out', when: 'Today, 10:55', len: '18 min' },
  { id: 'amma', kind: 'voice', dir: 'in', when: 'Today, 08:12', len: '6 min' },
  { id: 'meera', kind: 'voice', dir: 'out', when: 'Yesterday', len: '3 min' },
  { id: 'arjun', kind: 'video', dir: 'in', when: 'Mon', len: '25 min' },
]

export default function Calls() {
  return (
    <div className="screen">
      <header className="home-head">
        <h1>Calls</h1>
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 15 }}>Every call is translated live, both ways.</p>
      </header>
      <div className="scroll">
        {LOG.map((l) => {
          const c = CONTACTS.find((x) => x.id === l.id)!
          const Dir = l.dir === 'in' ? PhoneIncoming : PhoneOutgoing
          return (
            <div key={l.id + l.when} className="chat-row">
              <Avatar c={c} />
              <div className="chat-row-main">
                <span className="name">{c.name}</span>
                <span className="preview" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Dir size={15} aria-hidden="true" />{l.kind === 'video' ? 'Video' : 'Voice'}, {l.when}, {l.len}
                </span>
                <span><ModeTag mode={c.mode} /></span>
              </div>
              <Link to={`/call/voice/${c.id}`} className="icon-btn" aria-label={`Voice call ${c.name}`}><Phone size={20} aria-hidden="true" /></Link>
              <Link to={`/call/video/${c.id}`} className="icon-btn signal" aria-label={`Video call ${c.name}`}><Video size={20} aria-hidden="true" /></Link>
            </div>
          )
        })}
      </div>
      <TabBar />
    </div>
  )
}
