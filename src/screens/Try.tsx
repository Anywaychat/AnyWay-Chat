import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, MessageCircle } from 'lucide-react'
import { MODES, modeOf, useAuth, type Mode } from '../state'
import { ModeIcon } from '../components/ui'

const ICON_BG: Record<Mode, string> = { blind: 'hue-indigo', deaf: 'hue-coral', speech: 'hue-emerald', standard: 'hue-slate' }
const WAYS: Mode[] = ['deaf', 'blind', 'speech', 'standard']
const WHAT: Record<Mode, string> = {
  deaf: 'Sign to your camera. Replies come as text and signs.',
  blind: 'Talk to send and hear every reply. Say “Hey Chat”.',
  speech: 'Tap picture phrases and AnyWay says them out loud.',
  standard: 'Type or talk, and see how each friend gets it.',
}
const asMode = (v: string | null): Mode | null => (WAYS.includes(v as Mode) ? (v as Mode) : null)

/**
 * "Try it now": one tap makes a guest account (no sign-up) with three demo friends who answer by themselves.
 * /try?as=deaf starts straight away. /try?pair=CODE comes from a "Call yourself from your phone" QR code and
 * starts in a chat with whoever showed it.
 */
export default function Try() {
  const { user, tryAs, joinPair, setMode } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const pair = (params.get('pair') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
  const wanted = asMode(params.get('as'))
  const [busy, setBusy] = useState<Mode | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState<{ name: string; mode: Mode } | null>(null)
  const [expired, setExpired] = useState(false)
  const handled = useRef(false)

  // Whose code is this? The page says who you are joining.
  useEffect(() => {
    if (!pair) return
    let alive = true
    fetch(`/api/pair/${pair}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { from?: { name: string; mode: string } }
        if (!alive) return
        if (r.ok && j.from) setFrom({ name: j.from.name, mode: modeOf(j.from.mode) })
        else setExpired(true)
      })
      .catch(() => alive && setExpired(true))
    return () => {
      alive = false
    }
  }, [pair])

  const start = async (m: Mode) => {
    handled.current = true
    setBusy(m)
    setError(null)
    const r = await tryAs(m, pair || undefined)
    if (r.error) {
      setBusy(null)
      setError(r.error)
      return
    }
    nav(r.with ? `/chat/${r.with.id}` : '/home', { replace: true })
  }
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    if (handled.current) return
    if (user) {
      // Signed in already: a pairing code waits for "Join"; otherwise go to the chats
      // (a guest asking for another way of talking switches to it).
      if (pair) return
      handled.current = true
      if (wanted && user.guest && wanted !== user.mode) void setMode(wanted).finally(() => nav('/home', { replace: true }))
      else nav('/home', { replace: true })
      return
    }
    // The landing page's "I'm deaf" link names the way of talking: start straight away.
    if (wanted && !pair) void startRef.current(wanted)
  }, [user, pair, wanted, setMode, nav])

  const join = async () => {
    setBusy('join')
    setError(null)
    const r = await joinPair(pair)
    setBusy(null)
    if (r.error || !r.contact) setError(r.error ?? 'Could not join.')
    else nav(`/chat/${r.contact.id}`, { replace: true })
  }

  // From a laptop in talk-and-type mode, the phone is most interesting as a deaf person; otherwise as a hearing one.
  const order: Mode[] = pair ? (from?.mode === 'standard' ? ['deaf', 'speech', 'blind', 'standard'] : ['standard', 'deaf', 'speech', 'blind']) : WAYS

  return (
    <div className="screen welcome auth try-page">
      <div className="brand">
        <span className="brand-mark"><MessageCircle size={18} aria-hidden="true" /></span>
        AnyWay Chat
      </div>
      {pair ? (
        expired ? (
          <>
            <h1>This QR code has expired</h1>
            <p className="lede">Codes last 30 minutes. Ask for a new one, or try AnyWay on your own below.</p>
          </>
        ) : (
          <>
            <h1>{from ? `Join ${from.name}` : 'Join your other screen'}</h1>
            <p className="lede">
              {user
                ? `You'll be added to each other's chats, ready to message and call.`
                : `Pick how you talk on this phone. You'll be in a chat with ${from?.name ?? 'them'}, ready to call. No sign-up.`}
            </p>
          </>
        )
      ) : (
        <>
          <h1>Try AnyWay in one tap</h1>
          <p className="lede">
            No sign-up. You get a guest account with three demo friends who answer by themselves: <strong>Priya</strong> is deaf and signs, <strong>Arjun</strong> is blind and talks, <strong>Meera</strong> can’t speak and taps.
          </p>
        </>
      )}

      {user && pair && !expired ? (
        <button className="btn primary block" disabled={!!busy} onClick={() => void join()}>
          {busy === 'join' ? 'Joining…' : `Join as ${user.name}`}
        </button>
      ) : (
        <div className="mode-list" role="group" aria-label="Try AnyWay as">
          {(expired ? WAYS : order).map((m, i) => (
            <button key={m} type="button" className="mode-opt" disabled={!!busy} aria-busy={busy === m} onClick={() => void start(m)}>
              <span className={`mode-ico ${ICON_BG[m]}`}><ModeIcon mode={m} /></span>
              <span>
                <strong>{MODES[m].label}{pair && !expired && i === 0 ? <span className="try-suggest">Suggested</span> : null}</strong>
                <span>{WHAT[m]}</span>
              </span>
              {busy === m && <Loader2 className="check spin" size={22} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      {busy && busy !== 'join' && <p className="muted" role="status">Setting up your guest account…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!user && <p className="muted">You can switch to another way of talking any time, and keep the account later with a username and password.</p>}
      <p className="muted" style={{ textAlign: 'center' }}>
        <Link to="/signup" className="link">Create an account</Link> · <Link to="/login" className="link">Log in</Link>
      </p>
    </div>
  )
}
