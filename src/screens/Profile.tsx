import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Camera, LogOut } from 'lucide-react'
import { useAuth } from '../state'
import { Avatar, TabBar } from '../components/ui'
import { contactById } from '../state'

export default function Profile() {
  const { user, logout, setAvatar } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoErr, setPhotoErr] = useState<string | null>(null)
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
              <button className="avatar-edit" aria-label="Change profile photo" onClick={() => fileRef.current?.click()}>
                <Avatar c={{ ...me, avatar: user.avatar }} />
                <span className="avatar-cam"><Camera size={13} aria-hidden="true" /></span>
              </button>
              <span className="grow"><strong>{user.name}</strong><span>@{user.id}</span></span>
              {user.avatar && <button className="btn" style={{ height: 34 }} onClick={() => setAvatar(null)}>Remove photo</button>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  setPhotoErr(null)
                  try {
                    await setAvatar(await shrink(f))
                  } catch {
                    setPhotoErr('That photo could not be used. Try another one.')
                  }
                }}
              />
            </div>
          </div>
          {photoErr && <p className="form-error">{photoErr}</p>}
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Tap your photo to change it. Share your username so friends can add you.</p>
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

/** Crops to a square and shrinks to 192px so it stays small enough to store and send around. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height)
  const c = document.createElement('canvas')
  c.width = c.height = 192
  c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 192, 192)
  return c.toDataURL('image/jpeg', 0.82)
}
