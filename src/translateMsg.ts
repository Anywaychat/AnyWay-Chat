import { useEffect, useState } from 'react'
import { readSession } from './state'
import { base, getLang, getUnderstood, langName, useLang, useUnderstood } from './lang'
import { langOfText } from './speech'

/** A chat message in the reader's language: detected, then translated unless they understand it. */
export type Translated = { text: string; from: string; fromName: string; failed?: boolean }
const cache = new Map<string, Promise<{ text: string; from: string; failed?: boolean } | null>>()

const understands = (l: string) => !l || base(l) === base(getLang()) || getUnderstood().some((u) => base(u) === base(l))

function fetchTr(text: string, to: string) {
  const k = `${to}|${text}`
  let p = cache.get(k)
  if (!p) {
    p = fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${readSession() ?? ''}` }, body: JSON.stringify({ text, from: 'auto', to }) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    p.then((v) => { if (!v || v.failed) cache.delete(k) })
    cache.set(k, p)
  }
  return p
}

/** Returns the translation for this reader, or null when they understand the message as it is. */
export async function translateForMe(text: string): Promise<Translated | null> {
  if (!text.trim() || !/\p{L}/u.test(text)) return null
  const r = await fetchTr(text, base(getLang()))
  // Couldn't translate: say so when the text is clearly in another script than the reader's language.
  if (!r || r.failed) return base(langOfText(text)) !== base(getLang()) ? { text, from: '', fromName: '', failed: true } : null
  if (!r.text || understands(r.from) || r.text.trim().toLowerCase() === text.trim().toLowerCase()) return null
  return { text: r.text, from: r.from, fromName: langName(r.from) }
}

export function useTranslated(text: string, on = true) {
  const lang = useLang()
  const und = useUnderstood()
  const [t, setT] = useState<Translated | null>(null)
  useEffect(() => {
    if (!on) return setT(null)
    let alive = true
    void translateForMe(text).then((v) => alive && setT(v))
    return () => { alive = false }
  }, [text, on, lang, und])
  return t
}
