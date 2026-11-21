import { enablePush } from '../push'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BookOpen, Camera, Star, CheckCircle2, LogOut, Pencil } from 'lucide-react'
import { MODES, useAuth, type Mode } from '../state'
import { Avatar, ModeIcon, TabBar } from '../components/ui'
import { preloadNaturalVoice } from '../speech'
import InstallButton from '../components/InstallButton'
import { SIZES, setDisplay, useDisplay } from '../display'
import { base, setLang, setUnderstood, useLang, useUnderstood } from '../lang'
import LangPicker from '../components/LangPicker'
import { setBlindPrefs, useBlindPrefs, type Announce } from '../blindPrefs'
import { chooseVoice, chosenVoice, setRate, speak as say, voicesFor } from '../speech'
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
        {user.guest && <KeepGuest />}
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

        {user?.mode === 'blind' && <Listening />}
        {(user?.mode === 'blind' || user?.mode === 'speech') && <VoiceSettings mine={user?.mode === 'speech'} />}
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
          <button
            className="btn block"
            onClick={async () => {
              // A guest account has no password: logging out loses it.
              if (user.guest && !window.confirm('This is a guest account with no password. If you log out, you can’t come back to it. Log out anyway?')) return
              await logout()
              nav(user.guest ? '/try' : '/login')
            }}
          >
            <LogOut size={16} aria-hidden="true" />Log out
          </button>
        </div>
      </div>
      <TabBar />
    </div>
  )
}

/** A guest (from "Try it now") keeps their account: their own username and a password, with contacts and settings. */
function KeepGuest() {
  const { keepGuest } = useAuth()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (location.hash === '#keep') ref.current?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <div className="section" id="keep" ref={ref}>
      <form
        className="panel keep-guest"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          const err = await keepGuest({ username, name, password })
          if (err) {
            setBusy(false)
            setError(err)
          }
        }}
      >
        <h2>Keep this account</h2>
        <p className="muted">You’re using a guest account. Pick a username and a password to keep your contacts and settings and to log in on other devices. Guest accounts are removed after 14 days.</p>
        <label className="field-label">Your name
          <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <label className="field-label">Username
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} required minLength={3} maxLength={32} />
          <span className="field-hint">Letters and numbers only. Friends add you by it.</span>
        </label>
        <label className="field-label">Password
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <span className="field-hint">At least 6 characters</span>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Keep my account'}</button>
      </form>
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
        <LangRow />
        <label className="disp-row check-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={d.contrast} onChange={(e) => setDisplay({ contrast: e.target.checked })} />
          <span><strong>High contrast</strong><br /><small>Black and white with strong borders</small></span>
        </label>
      </div>
    </div>
  )
}

/** Languages: the one you speak (calls hear you in it, others are translated into it) and others you understand. */
function LangRow() {
  const lang = useLang()
  const und = useUnderstood()
  return (
    <div className="disp-row">
      <strong>Languages</strong>
      <LangPicker speak={lang} understand={und} onSpeak={setLang} onUnderstand={setUnderstood} />
    </div>
  )
}

/** Blind users: how new messages are read out, how fast AnyWay talks, and message sounds. */
function Listening() {
  const p = useBlindPrefs()
  const opts: [Announce, string, string][] = [['full', 'Read the whole message', 'Who sent it and what it says'], ['sender', 'Only who sent it', 'Private: the message is not read out'], ['off', 'Silent', 'Only the message sound']]
  return (
    <div className="section">
      <h2>Listening</h2>
      <div className="panel">
        <div className="disp-row" role="radiogroup" aria-label="When a message arrives">
          <strong>When a message arrives</strong>
          {opts.map(([v, l, d]) => (
            <label key={v} className="check-row" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="radio" name="announce" checked={p.announce === v} onChange={() => { setBlindPrefs({ announce: v }); say(`${l}.`, true) }} />
              <span><strong>{l}</strong><br /><small>{d}</small></span>
            </label>
          ))}
        </div>
        <label className="disp-row check-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={p.sounds} onChange={(e) => setBlindPrefs({ sounds: e.target.checked })} />
          <span><strong>Message sound</strong><br /><small>A short sound when a message arrives</small></span>
        </label>
        <label className="disp-row check-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={p.screenReader} onChange={(e) => setBlindPrefs({ screenReader: e.target.checked })} />
          <span><strong>I use a screen reader (TalkBack or VoiceOver)</strong><br /><small>Your screen reader reads messages and updates, so nothing is said twice. "Hey Chat" turns off; use Tap to speak or the Space key.</small></span>
        </label>
      </div>
    </div>
  )
}

const SAMPLE: Record<string, string> = {
  en: 'Hello. This is how AnyWay sounds.',
  hi: 'नमस्ते। AnyWay ऐसे बोलता है।',
  ta: 'வணக்கம். AnyWay இப்படித்தான் பேசும்.',
  te: 'నమస్కారం. AnyWay ఇలా మాట్లాడుతుంది.',
  kn: 'ನಮಸ್ಕಾರ. AnyWay ಹೀಗೆ ಮಾತನಾಡುತ್ತದೆ.',
  ml: 'നമസ്കാരം. AnyWay ഇങ്ങനെയാണ് സംസാരിക്കുന്നത്.',
  bn: 'নমস্কার। AnyWay এভাবে কথা বলে।',
  mr: 'नमस्कार. AnyWay असे बोलते.',
  gu: 'નમસ્તે. AnyWay આ રીતે બોલે છે.',
  pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ। AnyWay ਇਸ ਤਰ੍ਹਾਂ ਬੋਲਦਾ ਹੈ।',
  ur: 'السلام علیکم۔ AnyWay ایسے بولتا ہے۔',
}

/** The voice AnyWay speaks with: which voice, how fast, and the optional natural (English) voice.
 *  For someone who can't speak this is their own voice, so they can pick one that suits them. */
function VoiceSettings({ mine }: { mine: boolean }) {
  const lang = useLang()
  const p = useBlindPrefs()
  const [list, setList] = useState(() => voicesFor(lang))
  const [pick, setPick] = useState(() => chosenVoice(lang))
  useEffect(() => {
    const load = () => setList(voicesFor(lang))
    load()
    setPick(chosenVoice(lang))
    const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis
    synth?.addEventListener?.('voiceschanged', load)
    return () => synth?.removeEventListener?.('voiceschanged', load)
  }, [lang])
  const sample = () => say(SAMPLE[base(lang)] ?? SAMPLE.en, true, lang)
  return (
    <div className="section">
      <h2>{mine ? 'Your voice' : 'Voice'}</h2>
      <div className="panel">
        <label className="disp-row">
          <strong>{mine ? 'The voice that speaks for you' : 'The voice that reads to you'}</strong>
          <select className="input" value={pick} onChange={(e) => { chooseVoice(lang, e.target.value); setPick(e.target.value); setTimeout(sample, 50) }}>
            <option value="">Automatic (the clearest one)</option>
            {list.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          {list.length === 0 && <small>This device has no voice for this language yet. Add one in your phone's text-to-speech settings.</small>}
        </label>
        <div className="disp-row" role="group" aria-label="Speaking speed">
          <strong>Speaking speed</strong>
          <div className="seg">{([[0.8, 'Slow'], [1, 'Normal'], [1.25, 'Fast'], [1.5, 'Fastest']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={p.rate === v} onClick={() => { setBlindPrefs({ rate: v }); setRate(v); say(`${l} speed.`, true) }}>{l}</button>)}</div>
        </div>
        <label className="disp-row check-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={p.natural} onChange={(e) => setBlindPrefs({ natural: e.target.checked })} />
          <span><strong>Natural voice (English)</strong><br /><small>More human-sounding. Downloads about 330 MB once and needs a fast computer. Your phone's voice is used until it's ready, and for other languages.</small></span>
        </label>
        <div className="disp-row"><button type="button" className="btn" onClick={sample}>Hear it</button></div>
      </div>
    </div>
  )
}
