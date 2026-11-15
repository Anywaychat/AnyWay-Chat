import { Link } from 'react-router-dom'
import { ArrowUpDown, Hand, LayoutGrid, Mic, Volume2 } from 'lucide-react'
import { useProfile, type Mode } from '../state'

const SAID: Record<Mode, { you: string; how: string }> = {
  deaf: { you: 'How much is this rice bag?', how: 'Customer signed' },
  speech: { you: 'How much is this rice bag?', how: 'Customer tapped' },
  blind: { you: 'How much is this rice bag?', how: 'Customer said' },
  deafblind: { you: 'How much is this rice bag?', how: 'Customer typed' },
  standard: { you: 'How much is this rice bag?', how: 'Customer said' },
}

export default function Go() {
  const { mode } = useProfile()
  const s = SAID[mode]

  return (
    <div className="screen">
      <section className="go-top" aria-label="Side facing the other person">
        <div className="row-between">
          <strong style={{ fontSize: 15 }}>For the person you’re talking to</strong>
          <span className="muted-dark">Just talk normally</span>
        </div>
        <span className="muted-dark">{s.how}:</span>
        <div className="them-said">{s.you}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#000', fontWeight: 700, fontSize: 15 }}>
          <Volume2 size={20} aria-hidden="true" />Spoken aloud in Tamil and English
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary block"><Mic size={22} aria-hidden="true" />Listening to you</button>
      </section>

      <div className="go-seam">
        <ArrowUpDown size={18} aria-hidden="true" />
        AnyWay interpreter. Put the phone between you.
      </div>

      <section className="go-bottom" aria-label="Your side">
        <div className="row-between">
          <strong style={{ fontSize: 15 }}>Your side</strong>
          <Link to="/home" style={{ color: 'var(--live)', fontWeight: 700, fontSize: 15 }}>Save and end</Link>
        </div>
        <span className="muted">Shopkeeper said:</span>
        <div className="them-said">₹450 for the 5 kilo bag.</div>
        <div className="go-strip">
          {mode === 'deaf' ? (
            <div className="sign-clip" style={{ background: '#1A2130', color: '#fff', margin: 0 }}>
              <span className="thumb"><Hand size={22} aria-hidden="true" /></span>
              <span>450 · RUPEES · 5 · KILO</span>
            </div>
          ) : (
            <div className="show-card">Show this: “I can’t speak. Please talk to my phone.”</div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div className="grid-3">
          <button className="btn"><Hand size={18} aria-hidden="true" />Sign</button>
          <button className="btn"><LayoutGrid size={18} aria-hidden="true" />Phrases</button>
          <button className="btn"><Mic size={18} aria-hidden="true" />Speak</button>
        </div>
      </section>
    </div>
  )
}
