import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Smartphone, Sparkles, X } from 'lucide-react'
import { useAuth, type Mode } from '../state'
import { AS, markTried, SHORT, STEPS, useShowTry, useTried } from '../tryIt'
import { ModeIcon } from './ui'
import PairModal from './PairModal'

export default function TryCard({ big = false }: { big?: boolean }) {
  const { user, setMode } = useAuth()
  const { show, hide } = useShowTry()
  const done = useTried()
  const [pairing, setPairing] = useState(false)
  const [switching, setSwitching] = useState<Mode | null>(null)
  if (!user || (!show && !big)) return null
  const mode = user.mode
  const steps = STEPS[mode]
  const mark = markTried
  const count = steps.filter((s) => done.includes(`${mode}:${s.key}`)).length

  if (!show) {
    // The laptop's empty side once the card is closed.
    return (
      <div className="empty-pane">
        <span className="empty-ico"><Sparkles size={34} aria-hidden="true" /></span>
        <h2>Pick a chat to start talking</h2>
        <p>Every message is translated into the way each person understands it.</p>
      </div>
    )
  }

  return (
    <section className={big ? 'try-card big' : 'try-card'} aria-labelledby="try-title">
      <div className="try-head">
        <span className="go-ico"><Sparkles size={18} aria-hidden="true" /></span>
        <div>
          <h2 id="try-title">{big ? 'Welcome! Here’s what to try' : 'Things to try'}</h2>
          <p className="sub">
            You’re trying AnyWay as <strong>{AS[mode]}</strong> · {count} of {steps.length} done
          </p>
        </div>
        <button className="icon-btn" aria-label="Close things to try" onClick={hide}><X size={18} aria-hidden="true" /></button>
      </div>
      <ol className="try-steps">
        {steps.map((s) => {
          const k = `${mode}:${s.key}`
          const isDone = done.includes(k)
          const body = (
            <>
              {isDone ? <CheckCircle2 className="try-tick on" size={20} aria-hidden="true" /> : <Circle className="try-tick" size={20} aria-hidden="true" />}
              <span>
                <strong>{s.title}</strong>
                <span className="sub">{s.how}</span>
              </span>
              {s.pair && <Smartphone className="try-go" size={18} aria-hidden="true" />}
            </>
          )
          return (
            <li key={k}>
              {s.to ? (
                <Link to={s.to} className="try-step" onClick={() => mark(k)} aria-label={`${s.title}${isDone ? ', done' : ''}. ${s.how}`}>{body}</Link>
              ) : (
                <button type="button" className="try-step" onClick={() => { mark(k); if (s.pair) setPairing(true) }} aria-label={`${s.title}${isDone ? ', done' : ''}. ${s.how}`}>{body}</button>
              )}
            </li>
          )
        })}
      </ol>
      {user.guest && (
        <div className="try-ways" role="group" aria-label="Try another way of talking">
          <span className="sub">Try another way:</span>
          {(['deaf', 'blind', 'speech', 'standard'] as Mode[]).map((m) => (
            <button
              key={m}
              className="pill"
              aria-pressed={m === mode}
              disabled={!!switching}
              onClick={() => {
                if (m === mode) return
                setSwitching(m)
                void setMode(m).finally(() => setSwitching(null))
              }}
            >
              <ModeIcon mode={m} size={14} />
              {SHORT[m]}
            </button>
          ))}
        </div>
      )}
      {user.guest && (
        <p className="try-keep sub">
          This is a guest account. <Link to="/profile#keep" className="link">Keep it</Link> with a username and password.
        </p>
      )}
      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </section>
  )
}
