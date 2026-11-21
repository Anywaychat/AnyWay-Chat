import { LANGS, base } from '../lang'

/** Pick your one language: messages and calls in any other language are translated into it. */
export default function LangPicker({ speak, understand, onSpeak, onUnderstand }: { speak: string; understand: string[]; onSpeak: (l: string) => void; onUnderstand: (l: string[]) => void }) {
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
    </>
  )
}
