import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { LANGS, base, langName, setLang, setUnderstood, useLang, useUnderstood } from '../lang'

/**
 * Your language, always visible at the top of a chat and on a call: tap it to change the language messages and calls
 * are translated into.
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
  return (
    <div className={`lang-menu${dark ? ' dark-ui' : ''}`} ref={box}>
      <button type="button" className="lang-pill" aria-expanded={open} aria-label={`Translating into ${langName(lang)}. Change language`} onClick={() => setOpen((o) => !o)}>
        <Globe size={15} aria-hidden="true" />
        <span className="lang-name">{langName(lang)}</span>
      </button>
      {open && (
        <div className="lang-pop" role="dialog" aria-label="Language">
          <label className="field-label">Your language
            <select
              className="input"
              value={LANGS.find((l) => base(l.code) === base(lang))?.code ?? lang}
              onChange={(e) => {
                setLang(e.target.value)
                // One language only: anything else is translated into it.
                if (und.length) setUnderstood([])
              }}
            >
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.native} · ${l.name}`}</option>)}
            </select>
          </label>
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Messages and calls in other languages are translated into this one.</p>
        </div>
      )}
    </div>
  )
}
