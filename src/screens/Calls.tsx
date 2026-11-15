import { Link } from 'react-router-dom'
import { Phone, Video } from 'lucide-react'
import { useAuth } from '../state'
import { Avatar, ModeTag, TabBar } from '../components/ui'

export default function Calls() {
  const { contacts } = useAuth()
  return (
    <div className="screen">
      <header className="home-head">
        <h1>Calls</h1>
        <p>Every call is translated live, both ways.</p>
      </header>
      <div className="scroll">
        {contacts.length === 0 && <p className="hint" style={{ padding: 24 }}>Add a contact to start calling.</p>}
        {contacts.map((c) => (
          <div key={c.id} className="chat-row">
            <Avatar c={c} />
            <div className="chat-row-main">
              <span className="name" style={{ fontWeight: 700 }}>{c.name}</span>
              <span><ModeTag mode={c.mode} /></span>
            </div>
            <Link to={`/call/voice/${c.id}`} className="icon-btn" aria-label={`Voice call ${c.name}`}><Phone size={19} aria-hidden="true" /></Link>
            <Link to={`/call/video/${c.id}`} className="icon-btn" aria-label={`Video call ${c.name}`}><Video size={20} aria-hidden="true" /></Link>
          </div>
        ))}
      </div>
      <TabBar />
    </div>
  )
}
