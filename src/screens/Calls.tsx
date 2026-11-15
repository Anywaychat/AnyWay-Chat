import { Phone, Video } from 'lucide-react'
import { useAuth } from '../state'
import { startCall } from '../calls'
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
            <button className="icon-btn" aria-label={`Voice call ${c.name}`} onClick={() => startCall(c.id, false)}><Phone size={19} aria-hidden="true" /></button>
            <button className="icon-btn" aria-label={`Video call ${c.name}`} onClick={() => startCall(c.id, true)}><Video size={20} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      <TabBar />
    </div>
  )
}
