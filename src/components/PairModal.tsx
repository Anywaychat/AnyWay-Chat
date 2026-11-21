import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, MessageCircle, Phone, RefreshCw, Video, X } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { startCall } from '../calls'
import { MODES, toContact, useAuth, type User } from '../state'
import { Avatar } from './ui'

/** A QR code drawn as one SVG path (crisp at any size, no images). */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let path = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`
    return { size: n + 4, d: path }
  }, [text])
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#16161D" />
    </svg>
  )
}

/**
 * "Call yourself from your phone": a QR code that opens AnyWay on the phone as a second person, already in a chat
 * with you. Then a call shows the live captions, signs and translation between the two screens. The same code adds
 * a friend standing next to you.
 */
export default function PairModal({ onClose, purpose = 'self' }: { onClose: () => void; purpose?: 'self' | 'friend' }) {
  const { api, refreshContacts, user } = useAuth()
  const nav = useNavigate()
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<User | null>(null)
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    api<{ code: string }>('/pair', { method: 'POST' })
      .then((r) => {
        if (!alive) return
        setCode(r.code)
        setExpired(false)
        setError(null)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [api, round])

  // Wait for the phone to open the code.
  useEffect(() => {
    if (!code || joined || expired) return
    let alive = true
    const t = setInterval(async () => {
      const r = await api<{ joined: User | null; expired: boolean }>(`/pair/${code}/status`).catch(() => null)
      if (!alive || !r) return
      if (r.expired) setExpired(true)
      if (r.joined) {
        await refreshContacts().catch(() => {})
        if (alive) setJoined(r.joined)
      }
    }, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [api, code, joined, expired, refreshContacts])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const link = code ? `${location.origin}/try?pair=${code}` : ''
  const c = joined ? toContact(joined) : null
  const self = purpose === 'self'
  const call = (video: boolean) => {
    if (!c) return
    void startCall(c.id, video)
    onClose()
  }

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal pair-modal" role="dialog" aria-modal="true" aria-labelledby="pair-title" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2 id="pair-title">{c ? (self ? 'Your phone is connected' : `${c.name} is in your chats`) : self ? 'Call yourself from your phone' : 'Add someone next to you'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>

        {c ? (
          <>
            <div className="pair-joined" role="status">
              <Avatar c={c} />
              <div>
                <strong>{c.name}</strong>
                <span className="muted">{self ? 'joined from your phone' : 'joined'} · {MODES[c.mode].short}</span>
              </div>
            </div>
            <p className="muted">
              {self
                ? 'Call the phone from here and answer it there. Talk on one side and watch the live captions, signs and translations on the other.'
                : 'You can message and call each other now.'}
            </p>
            <div className="pair-actions">
              <button className="btn primary" onClick={() => call(true)}><Video size={18} aria-hidden="true" />Video call</button>
              <button className="btn" onClick={() => call(false)}><Phone size={18} aria-hidden="true" />Voice call</button>
              <button className="btn" onClick={() => { nav(`/chat/${c.id}`); onClose() }}><MessageCircle size={18} aria-hidden="true" />Open chat</button>
            </div>
          </>
        ) : (
          <>
            <ol className="pair-how">
              {self ? (
                <>
                  <li>Point your phone’s camera at this code and open the link.</li>
                  <li>
                    {user?.mode === 'standard'
                      ? 'Pick how you talk on the phone. Try “I’m deaf” to see your words arrive as captions and signs.'
                      : 'Pick how you talk on the phone. Try “I talk and type”: what you say there arrives here your way.'}
                  </li>
                  <li>Call your phone from here.</li>
                </>
              ) : (
                <>
                  <li>They point their phone’s camera at this code and open the link.</li>
                  <li>They pick how they talk. No app or sign-up needed.</li>
                </>
              )}
            </ol>
            <div className="pair-code">
              {error ? (
                <p className="form-error" role="alert">{error}</p>
              ) : expired ? (
                <div className="pair-expired">
                  <p>This code expired.</p>
                  <button className="btn" onClick={() => setRound((n) => n + 1)}><RefreshCw size={16} aria-hidden="true" />Make a new code</button>
                </div>
              ) : code ? (
                <QrCode text={link} label="QR code that opens AnyWay on your phone. The same link is written below." />
              ) : (
                <p className="muted" role="status">Making your code…</p>
              )}
            </div>
            {code && !expired && (
              <>
                <div className="pair-link">
                  <code>{link.replace(/^https?:\/\//, '')}</code>
                  <button
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})
                    }}
                  >
                    {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <p className="muted pair-wait" role="status"><span className="pulse-dot" aria-hidden="true" />Waiting for the other phone… The code works for 30 minutes.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
