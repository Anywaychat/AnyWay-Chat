/**
 * Settings follow the person, not the phone. Languages, voice, speed, text size and the blind and alert settings were
 * saved only on the device, so signing in on another phone (or a school's shared one) started over in English.
 */
import { getLang, getUnderstood, onLangChange, setLang, setUnderstood } from './lang'
import { getDisplay, onDisplayChange, setDisplay, type Display } from './display'
import { getBlindPrefs, onBlindPrefsChange, setBlindPrefs, type BlindPrefs } from './blindPrefs'
import { chosenVoices, onVoicesChange, setChosenVoices } from './speech'

export type Prefs = { lang?: string; understand?: string[]; display?: Partial<Display>; blind?: Partial<BlindPrefs>; voices?: Record<string, string> }

export function collectPrefs(): Prefs {
  return { lang: getLang(), understand: getUnderstood(), display: getDisplay(), blind: getBlindPrefs(), voices: chosenVoices() }
}

let applying = false
/** Puts the account's saved settings on this device. */
export function applyPrefs(p: Prefs) {
  applying = true
  try {
    if (p.lang) setLang(p.lang)
    if (Array.isArray(p.understand)) setUnderstood(p.understand)
    if (p.display) setDisplay(p.display)
    if (p.blind) setBlindPrefs(p.blind)
    if (p.voices) setChosenVoices(p.voices)
  } finally {
    applying = false
  }
}

/** Saves settings to the account a moment after they change. Returns a stop function. */
export function startPrefsSync(save: (p: Prefs) => Promise<unknown>): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    if (applying) return
    clearTimeout(t)
    t = setTimeout(() => void save(collectPrefs()).catch(() => {}), 1200)
  }
  const offs = [onLangChange(changed), onDisplayChange(changed), onBlindPrefsChange(changed), onVoicesChange(changed)]
  return () => {
    clearTimeout(t)
    offs.forEach((off) => off())
  }
}
