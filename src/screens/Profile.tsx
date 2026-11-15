import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MODES, useProfile } from '../state'
import { TabBar } from '../components/ui'

const PACKS = [
  { name: 'Indian Sign Language', what: 'Reads your signs and shows signs', status: 'on', label: 'In use' },
  { name: 'American Sign Language', what: 'Reads your signs and shows signs', status: 'ok', label: 'Installed' },
  { name: 'British Sign Language', what: 'Shows signs', status: 'get', label: 'Add' },
  { name: 'Singapore Sign Language', what: 'Being built with the deaf community', status: 'soon', label: 'Help build' },
]

function Toggle({ label, initial }: { label: string; initial: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <div className="panel-row">
      <span className="grow"><strong>{label}</strong></span>
      <button className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => setOn(!on)} />
    </div>
  )
}

export default function Profile() {
  const { mode, name } = useProfile()
  const info = MODES[mode]

  return (
    <div className="screen">
      <header className="home-head">
        <h1>{name}</h1>
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 15 }}>This is how AnyWay talks for you.</p>
      </header>
      <div className="scroll">
        <div className="section">
          <div className="panel send-recv">
            <div><small>You send by</small><strong>{info.sends}</strong></div>
            <div><small>You receive as</small><strong>{info.receives}</strong></div>
          </div>
          <Link to="/start" className="btn block">Change how I talk</Link>
        </div>

        <div className="section">
          <h2>Sign languages</h2>
          <div className="panel">
            {PACKS.map((p) => (
              <div key={p.name} className="panel-row">
                <span className="grow"><strong>{p.name}</strong><span>{p.what}</span></span>
                <span className={`status ${p.status}`}>{p.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>Spoken languages</h2>
          <div className="lang-row">
            <button className="chip-btn" aria-pressed="true">English</button>
            <button className="chip-btn" aria-pressed="true">Tamil</button>
            <button className="chip-btn" aria-pressed="false">Hindi</button>
            <button className="chip-btn" aria-pressed="false">Add language</button>
          </div>
        </div>

        <div className="section">
          <h2>Alerts and display</h2>
          <div className="panel">
            <Toggle label="Read new messages aloud" initial={mode === 'blind'} />
            <Toggle label="Flash the screen for new messages" initial={mode === 'deaf'} />
            <Toggle label="Vibrate patterns for each person" initial={mode === 'deafblind'} />
            <Toggle label="Extra large text" initial={mode !== 'standard'} />
          </div>
        </div>

        <div className="section" style={{ paddingBottom: 24 }}>
          <h2>Emergency</h2>
          <div className="panel">
            <div className="panel-row">
              <span className="grow"><strong>Amma</strong><span>Gets your location when you tap Emergency</span></span>
              <span className="status get">Edit</span>
            </div>
          </div>
        </div>
      </div>
      <TabBar />
    </div>
  )
}
