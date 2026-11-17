import { enablePush } from '../push'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BookOpen, Camera, Star, CheckCircle2, LogOut, Pencil } from 'lucide-react'
import { MODES, useAuth, type Mode } from '../state'
import { Avatar, ModeIcon, TabBar } from '../components/ui'
import { preloadNaturalVoice } from '../speech'
import InstallButton from '../components/InstallButton'
import { SIZES, setDisplay, useDisplay } from '../display'
import { contactById } from '../state'

export default function Profile() {
  const { user, logout, setAvatar, setName, setMode } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [nameMsg, setNameMsg] = useState<string | null>(null)
  const [modeMsg, setModeMsg] = useState<string | null>(null)
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
              {editing ? (
                <form
                  className="grow name-edit"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const err = await setName(draft)
                    setNameMsg(err ?? 'Name saved. Your friends will see it.')
                    if (!err) setEditing(false)
                  }}
                >
                  <input className="input" aria-label="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} required autoFocus />
                  <button className="btn primary" style={{ height: 40 }}>Save</button>
                  <button type="button" className="btn" style={{ height: 40 }} onClick={() => setEditing(false)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="grow"><strong>{user.name}</strong><span>@{user.id}</span></span>
                  <button className="icon-btn" aria-label="Change your name" onClick={() => { setDraft(user.name); setEditing(true); setNameMsg(null) }}><Pencil size={17} aria-hidden="true" /></button>
                </>
              )}
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

        {nameMsg && <div className="section" style={{ paddingTop: 0 }}><p className="form-ok" role="status">{nameMsg}</p></div>}

        <div className="section">
          <h2>How you talk</h2>
          <div className="mode-list" role="group" aria-label="How you talk">
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="mode-opt"
                aria-pressed={m === user.mode}
                onClick={async () => {
                  if (m === user.mode) return
                  if (m === 'blind') preloadNaturalVoice()
                  await setMode(m)
                  setModeMsg(`Switched to: ${MODES[m].label}.`)
                }}
              >
                <span className="mode-ico hue-slate"><ModeIcon mode={m} /></span>
                <span>
                  <strong>{MODES[m].label}</strong>
                  <span>{MODES[m].sends}, {MODES[m].receives.toLowerCase()}</span>
                </span>
                {m === user.mode && <CheckCircle2 className="check" size={22} aria-hidden="true" />}
              </button>
            ))}
          </div>
          {modeMsg && <p className="form-ok" role="status">{modeMsg}</p>}
        </div>

        <Display />

        <div className="section">
          <h2>Learn</h2>
          <div className="panel">
            <button className="panel-row" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav('/signs')}>
              <BookOpen size={18} aria-hidden="true" />
              <span className="grow"><strong>Sign dictionary</strong><span>See everyday words in Indian Sign Language</span></span>
            </button>
            <button className="panel-row" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav('/review')}>
              <Star size={18} aria-hidden="true" />
              <span className="grow"><strong>Give a review</strong><span>Tell us what you think, in your own language</span></span>
            </button>
          </div>
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
              {notif === 'default' && <button className="btn" style={{ height: 36 }} onClick={() => Notification.requestPermission().then((p) => { setNotif(p); if (p === 'granted') void enablePush() })}>Turn on</button>}
            </div>
          </div>
        </div>

        <div className="section">
          <InstallButton />
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

/** Text size, light/dark and high contrast, for everyone, saved on this device. */
function Display() {
  const d = useDisplay()
  return (
    <div className="section">
      <h2>Display</h2>
      <div className="panel">
        <div className="disp-row" role="group" aria-label="Text size">
          <strong>Text size</strong>
          <div className="seg">{SIZES.map((s) => <button key={s.v} type="button" aria-pressed={d.size === s.v} onClick={() => setDisplay({ size: s.v })} style={{ fontSize: 13 * s.v }}>{s.label}</button>)}</div>
        </div>
        <div className="disp-row" role="group" aria-label="Colours">
          <strong>Colours</strong>
          <div className="seg">{([['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={d.theme === v} onClick={() => setDisplay({ theme: v })}>{l}</button>)}</div>
        </div>
        <label className="disp-row check-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={d.contrast} onChange={(e) => setDisplay({ contrast: e.target.checked })} />
          <span><strong>High contrast</strong><br /><small>Black and white with strong borders</small></span>
        </label>
      </div>
    </div>
  )
}
