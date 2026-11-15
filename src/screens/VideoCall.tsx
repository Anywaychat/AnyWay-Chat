import { Link, useParams } from 'react-router-dom'
import { Hand, MessageCircle, MicOff, PhoneOff, SwitchCamera } from 'lucide-react'
import { contactById } from '../state'
import { Avatar } from '../components/ui'

export default function VideoCall() {
  const { id } = useParams()
  const c = contactById(id)

  return (
    <div className="screen call">
      <div className="video-main">
        <Avatar c={c} size="xl" />
        <div className="video-top">
          <div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{c.name}</div>
            <div style={{ fontSize: 14, color: '#C9D1DE' }}>Video call, 04:12</div>
          </div>
          <span className="pill-live">Live translation on</span>
        </div>
        <div className="sign-window" aria-label="Their words shown in sign language">
          <Hand size={28} aria-hidden="true" />
          Their words in ISL
        </div>
        <div className="pip" aria-label="Your camera">
          <div>
            <Hand size={30} color="#FFFFFF" aria-hidden="true" />
            <div>You, signing</div>
          </div>
        </div>
      </div>

      <section className="captions" aria-live="polite" aria-label="Live captions">
        <div className="prev">You signed, they heard: “Yes, I’ll come at 8.”</div>
        <div className="now">{c.name}: “Perfect, I’ll bring snacks.”</div>
      </section>

      <div className="video-ctrls">
        <div className="call-ctrls">
          <button className="ctrl"><i><MicOff size={24} aria-hidden="true" /></i>Mute</button>
          <button className="ctrl"><i><SwitchCamera size={24} aria-hidden="true" /></i>Flip</button>
          <Link to={`/chat/${c.id}`} className="ctrl"><i><MessageCircle size={24} aria-hidden="true" /></i>Chat</Link>
          <Link to={`/chat/${c.id}`} className="ctrl end"><i><PhoneOff size={24} aria-hidden="true" /></i>End</Link>
        </div>
      </div>
    </div>
  )
}
