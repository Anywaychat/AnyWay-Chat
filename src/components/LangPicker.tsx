import { LANGS, base } from '../lang'

/** Pick the one language you speak, and any others you understand (those are never translated for you). */
export default function LangPicker({ speak, understand, onSpeak, onUnderstand }: { speak: string; understand: string[]; onSpeak: (l: string) => void; onUnderstand: (l: string[]) => void }) {
  const others = LANGS.filter((l) => base(l.code) !== base(speak))
  return (
    <>
      <h3 className="lang-q">I speak</h3>
      <div className="lang-grid" role="radiogroup" aria-label="Language you speak">
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="radio" aria-checked={speak === l.code} className="lang-chip" onClick={() => { onSpeak(l.code); onUnderstand(understand.filter((u) => base(u) !== base(l.code))) }}>
            <strong lang={l.code}>{l.native}</strong>{l.native !== l.name && <span>{l.name}</span>}
          </button>
        ))}
      </div>
      <h3 className="lang-q">I also understand <small>(pick any)</small></h3>
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
      <p className="field-hint" style={{ marginTop: 8 }}>On calls, people speaking a language you understand are not translated. Others are translated into the language you speak.</p>
    </>
  )
}
