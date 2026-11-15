import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Eye } from 'lucide-react'
import { MODES, useProfile, type Mode } from '../state'
import { ModeIcon } from '../components/ui'

const ICON_BG: Record<Mode, string> = {
  blind: 'hue-indigo',
  deaf: 'hue-coral',
  speech: 'hue-emerald',
  deafblind: 'hue-violet',
  standard: 'hue-slate',
}

export default function Welcome() {
  const { mode, setMode } = useProfile()
  const nav = useNavigate()

  return (
    <div className="screen welcome">
      <div className="brand">
        <span className="brand-mark"><Eye size={20} strokeWidth={2.4} aria-hidden="true" /></span>
        AnyWay Chat
      </div>
      <div>
        <h1>How do you like to talk?</h1>
      </div>
      <p className="lede">Choose once. Everyone else talks normally, and AnyWay translates in between.</p>

      <div className="listen" role="status">
        <span className="bars" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>Listening. Say “blind”, “deaf” or “I can’t speak”.</span>
      </div>

      <div className="mode-list" role="group" aria-label="Your way of talking">
        {(Object.keys(MODES) as Mode[]).map((m) => {
          const info = MODES[m]
          const on = m === mode
          return (
            <button key={m} className="mode-opt" aria-pressed={on} onClick={() => setMode(m)}>
              <span className={`mode-ico ${ICON_BG[m]}`}><ModeIcon mode={m} /></span>
              <span>
                <strong>{info.label}</strong>
                <span>{info.sends}, {info.receives.toLowerCase()}</span>
              </span>
              {on && <CheckCircle2 className="check" size={24} aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <button className="btn primary block" onClick={() => nav('/home')}>Continue as {MODES[mode].short.toLowerCase()}</button>
      <button className="btn block" onClick={() => nav('/home')}>Try a demo conversation</button>
    </div>
  )
}
