import { Link, useParams } from 'react-router-dom'
import { Keyboard, MicOff, PhoneOff, Video, Volume2 } from 'lucide-react'
import { contactById, useProfile } from '../state'
import { Avatar } from '../components/ui'

export default function VoiceCall() {
  const { id } = useParams()
  const c = contactById(id)
  const { mode } = useProfile()

  const theyAre =
    c.mode === 'deaf'
      ? 'is deaf and replies by signing. You hear her in a natural voice.'
      : c.mode === 'speech'
        ? 'replies by tapping phrases. You hear them spoken aloud.'
        : 'is speaking. Everything is captioned live.'

  return (
    <div className="screen call call-voice">
      <span className="call-sub">Voice call, 02:36</span>
      <div className="ring" style={{ borderRadius: '50%' }}>
        <Avatar c={c} size="xl" />
      </div>
      <div className="call-name">{c.name}</div>
      <p className="call-sub" style={{ margin: 0 }}>{c.name} {theyAre}</p>

      <section className="live-panel" aria-live="polite" aria-label="Live translation">
        <div className="who"><Volume2 size={18} aria-hidden="true" />Speaking for {c.name}</div>
        <div className="said">“Can you bring the charger too?”</div>
        <div className="small">Signed in ISL, spoken to you</div>
        <hr />
        <div className="small">You said</div>
        <div style={{ fontSize: 18 }}>“Sure, I’ll bring it.”</div>
        <div className="small">Shown to {c.name} as captions and signs</div>
      </section>

      <div style={{ flex: 1 }} />

      <div className="call-ctrls">
        <button className="ctrl"><i><MicOff size={24} aria-hidden="true" /></i>Mute</button>
        <button className="ctrl"><i><Keyboard size={24} aria-hidden="true" /></i>{mode === 'speech' ? 'Phrases' : 'Type'}</button>
        <Link to={`/call/video/${c.id}`} className="ctrl"><i><Video size={24} aria-hidden="true" /></i>Video</Link>
        <Link to={`/chat/${c.id}`} className="ctrl end"><i><PhoneOff size={24} aria-hidden="true" /></i>End</Link>
      </div>
      {mode === 'blind' && <p className="call-sub" style={{ margin: 0 }}>Say “hang up” to end the call</p>}
    </div>
  )
}
