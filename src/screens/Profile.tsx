import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut } from 'lucide-react'
import { useAuth } from '../state'
import { Avatar, TabBar } from '../components/ui'
import { contactById } from '../state'

export default function Profile() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [notif, setNotif] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission)
  if (!user) return null
  const me = contactById(user.id)

  return (
    <div className="screen">
      <header className="home-head">
        <h1>Profile</h1>
      </header>
      <div className="scroll">
        <div className="section">
          <div className="panel">
            <div className="panel-row">
              <Avatar c={me} />
              <span className="grow"><strong>{user.name}</strong><span>@{user.id}</span></span>
            </div>
          </div>
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Share your username so friends can add you.</p>
        </div>

        <div className="section">
          <h2>Notifications</h2>
          <div className="panel">
            <div className="panel-row">
              <Bell size={18} aria-hidden="true" />
              <span className="grow">
                <strong>New message alerts</strong>
                <span>{notif === 'granted' ? 'On' : notif === 'denied' ? 'Blocked in your browser settings' : 'Off'}</span>
              </span>
              {notif === 'default' && <button className="btn" style={{ height: 36 }} onClick={() => Notification.requestPermission().then(setNotif)}>Turn on</button>}
            </div>
          </div>
        </div>

        <div className="section" style={{ paddingBottom: 24 }}>
          <button className="btn block" onClick={async () => { await logout(); nav('/login') }}>
            <LogOut size={16} aria-hidden="true" />Log out
          </button>
        </div>
      </div>
      <TabBar />
    </div>
  )
}
