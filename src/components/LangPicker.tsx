import { useState } from 'react'
import { LANGS, base } from '../lang'

/** Pick the one language you speak, and any others you understand (those are never translated for you). */
export default function LangPicker({ speak, understand, onSpeak, onUnderstand }: { speak: string; understand: string[]; onSpeak: (l: string) => void; onUnderstand: (l: string[]) => void }) {
  const others = LANGS.filter((l) => base(l.code) !== base(speak))
  // One question first: your language. "Also understand" is optional and folded away (two lists confused people).
  const [more, setMore] = useState(understand.length > 0)
  return (
    <>
      <h3 className="lang-q">Your language</h3>
      <div className="lang-grid" role="radiogroup" aria-label="Language you speak">
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="radio" aria-checked={speak === l.code} className="lang-chip" onClick={() => { onSpeak(l.code); onUnderstand(understand.filter((u) => base(u) !== base(l.code))) }}>
            <strong lang={l.code}>{l.native}</strong>{l.native !== l.name && <span>{l.name}</span>}
          </button>
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: 8 }}>Messages and calls in other languages are translated into this one.</p>
      {!more ? (
        <button type="button" className="link-btn lang-more" onClick={() => setMore(true)}>+ I understand other languages too (optional)</button>
      ) : (
      <>
      <h3 className="lang-q">I also understand <small>(optional: these are not translated for you)</small></h3>
      <div className="lang-grid" role="group" aria-label="Other languages you understand">
        {others.map((l) => {
          const on = understand.some((u) => base(u) === base(l.code))
          return (
            <button key={l.code} type="button" aria-pressed={on} className="lang-chip" onClick={() => onUnderstand(on ? understand.filter((u) => base(u) !== base(l.code)) : [...understand, l.code])}>
              <strong lang={l.code}>{l.native}</strong>{l.native !== l.name && <span>{l.name}</span>}
            </button>
          )
        })}
      </div>
      </>
      )}
    </>
  )
}
