import { preloadNaturalVoice } from '../speech'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, MessageCircle } from 'lucide-react'
import { MODES, useAuth, type Mode } from '../state'
import { ModeIcon } from '../components/ui'
import InstallButton from '../components/InstallButton'

const ICON_BG: Record<Mode, string> = {
  blind: 'hue-indigo',
  deaf: 'hue-coral',
  speech: 'hue-emerald',
  standard: 'hue-slate',
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><MessageCircle size={18} aria-hidden="true" /></span>
      AnyWay Chat
    </div>
  )
}

export function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Signed out because the login ended (logged out on another device, or removed): say why.
  const [expired] = useState(() => {
    try {
      const e = sessionStorage.getItem('anyway.expired') === '1'
      sessionStorage.removeItem('anyway.expired')
      return e
    } catch {
      return false
    }
  })

  return (
    <form
      className="screen welcome auth"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const err = await login(username, password)
        setBusy(false)
        if (err) setError(err)
        else nav('/home')
      }}
    >
      <Brand />
      <h1>Log in</h1>
      {expired && <p className="form-error" role="alert">You were signed out because your login ended. Please log in again.</p>}
      <p className="lede">Welcome back. Your chats and contacts are waiting.</p>
      <label className="field-label">Username
        <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="field-label">Password
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="muted" style={{ textAlign: 'center' }}>New to AnyWay? <Link to="/signup" className="link">Create an account</Link></p>
      <InstallButton />
    </form>
  )
}

import { LANGS, base, setLang, setUnderstood } from '../lang'
import LangPicker from '../components/LangPicker'

export function Signup() {
  const { signup } = useAuth()
  const nav = useNavigate()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('standard')
  // Start from the phone's language when we support it.
  const [lang, setLangPick] = useState(() => LANGS.find((l) => base(l.code) === base(navigator.language ?? ''))?.code ?? 'en-IN')
  const [und, setUnd] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (step === 1)
    return (
      <form
        className="screen welcome auth"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          setStep(2)
        }}
      >
        <Brand />
        <h1>Create your account</h1>
        <p className="lede">Friends add you by your username.</p>
        <label className="field-label">Your name
          <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <label className="field-label">Username
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} required minLength={3} maxLength={32} />
          <span className="field-hint">Letters and numbers only</span>
        </label>
        <label className="field-label">Password
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <span className="field-hint">At least 6 characters</span>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block">Next</button>
        <p className="muted" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login" className="link">Log in</Link></p>
      </form>
    )

  return (
    <div className="screen welcome auth">
      <Brand />
      <h1>How do you like to talk?</h1>
      <p className="lede">You choose this once. You can change it later in your profile.</p>
      <div className="mode-list" role="group" aria-label="Your way of talking">
        {(Object.keys(MODES) as Mode[]).map((m) => (
          <button key={m} type="button" className="mode-opt" aria-pressed={m === mode} onClick={() => {
            setMode(m)
            // Start downloading the natural voice right away, so it's ready by the time they reach their chats.
            if (m === 'blind') preloadNaturalVoice()
          }}>
            <span className={`mode-ico ${ICON_BG[m]}`}><ModeIcon mode={m} /></span>
            <span>
              <strong>{MODES[m].label}</strong>
              <span>{MODES[m].sends}, {MODES[m].receives.toLowerCase()}</span>
            </span>
            {m === mode && <CheckCircle2 className="check" size={22} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <h2 className="lang-q" style={{ fontSize: 20 }}>Your languages</h2>
      <LangPicker speak={lang} understand={und} onSpeak={setLangPick} onUnderstand={setUnd} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="btn primary block"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setLang(lang)
          setUnderstood(und)
          const err = await signup({ username, name, password, mode })
          setBusy(false)
          if (err) {
            setError(err)
            if (/username|name|password/i.test(err)) setStep(1)
          } else nav('/home')
        }}
      >
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      <button type="button" className="btn block" onClick={() => setStep(1)}>Back</button>
    </div>
  )
}
