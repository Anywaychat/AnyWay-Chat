import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { LANGS, base, langName, setLang, setUnderstood, useLang, useUnderstood } from '../lang'

/**
 * Your language, always visible at the top of a chat and on a call: tap it to change the language messages and calls
 * are translated into, and (optional) tick languages you also understand, which are then left as they are.
 */
export default function LangMenu({ dark = false }: { dark?: boolean }) {
  const lang = useLang()
  const und = useUnderstood()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const others = LANGS.filter((l) => base(l.code) !== base(lang))
  return (
    <div className={`lang-menu${dark ? ' dark-ui' : ''}`} ref={box}>
      <button type="button" className="lang-pill" aria-expanded={open} aria-label={`Translating into ${langName(lang)}. Change language`} onClick={() => setOpen((o) => !o)}>
        <Globe size={15} aria-hidden="true" />
        {langName(lang)}
      </button>
      {open && (
        <div className="lang-pop" role="dialog" aria-label="Language">
          <label className="field-label">Your language
            <select
              className="input"
              value={LANGS.find((l) => base(l.code) === base(lang))?.code ?? lang}
              onChange={(e) => {
                setLang(e.target.value)
                setUnderstood(und.filter((u) => base(u) !== base(e.target.value)))
              }}
            >
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.native} · ${l.name}`}</option>)}
            </select>
          </label>
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Messages and calls in other languages are translated into this one.</p>
          <details open={und.length > 0}>
            <summary>I also understand (optional)</summary>
            <div className="lang-checks">
              {others.map((l) => {
                const on = und.some((u) => base(u) === base(l.code))
                return (
                  <label key={l.code} className="lang-check">
                    <input type="checkbox" checked={on} onChange={() => setUnderstood(on ? und.filter((u) => base(u) !== base(l.code)) : [...und, l.code])} />
                    {l.name}
                  </label>
                )
              })}
            </div>
            <p className="hint" style={{ textAlign: 'left', margin: 0 }}>These are shown as they are, not translated.</p>
          </details>
        </div>
      )}
    </div>
  )
}
